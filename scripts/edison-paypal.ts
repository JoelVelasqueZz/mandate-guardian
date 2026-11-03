import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { paypalFromEnv, PayPalError, requestIdFor, approvalUrl, firstAuthorization, firstCapture,
  type PayPalOrder, type Payment } from "../src/paypal/client.js";

type Mode = "A" | "VOID" | "B" | "DISPUTE";
type Outcome = "OK" | "PENDING" | "FAIL" | "NOT_TESTED";
interface Flow {
  runId: string; orderId?: string; approveUrl?: string; authorizationId?: string;
  captureId?: string; refundId?: string; capturedAt?: string;
}
interface Event { step: string; action: string; mode: string; outcome: Outcome; at: string; file: string; detail: string }
interface State { flows: Partial<Record<Mode, Flow>>; events: Event[] }
const folder = path.resolve(".local/edison-paypal");
const statePath = path.join(folder, "state.json");
async function load(): Promise<State> {
  try { return JSON.parse(await readFile(statePath, "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { flows: {}, events: [] }; throw e; }
}
async function save(state: State) {
  await mkdir(folder, { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2) + "\n");
}
function ensure(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function stepFor(action: string, mode: string) {
  if (action === "disputes" || action === "dispute-confirm") return "8";
  if (mode === "VOID") return action === "void" ? "5" : `5-${action}`;
  const n: Record<string, string> = { create: "1", check: "2", authorize: "3", capture: "4", refund: "6", search: "7" };
  return (mode === "A" ? "" : `${mode}-`) + (n[action] ?? action);
}
async function evidence(state: State, action: string, mode: string, outcome: Outcome, response: unknown, detail: string) {
  await mkdir(folder, { recursive: true });
  const name = `${Date.now()}-${action}-${mode}-${randomUUID().slice(0, 6)}.json`;
  await writeFile(path.join(folder, name), JSON.stringify(response, null, 2) + "\n");
  state.events.push({ step: stepFor(action, mode), action, mode, outcome, at: new Date().toISOString(),
    file: `.local/edison-paypal/${name}`, detail });
  await save(state);
  console.log(`${outcome}: ${detail}\nPrivate response: .local/edison-paypal/${name}`);
}
async function report(state: State) {
  const labels = ["Create AUTHORIZE order", "Buyer approval verified", "Authorize order", "Capture authorization",
    "Void a second authorization", "Full refund", "Transaction Search finds capture", "Create a sandbox dispute (optional)"];
  const last = (step: string) => [...state.events].reverse().find(e => e.step === step);
  const rows = labels.map((label, i) => {
    const e = last(String(i + 1));
    return `| ${i + 1} | ${label} | ${e?.outcome ?? "NOT_TESTED"} | ${e?.detail.replace(/\|/g, "/") ?? "Not executed"} | ${e?.file ?? "-"} |`;
  });
  const aReady = ["1", "2", "3", "4", "5", "6"].every(n => last(n)?.outcome === "OK");
  const bReady = ["B-1", "B-2", "B-4", "B-6"].every(n => last(n)?.outcome === "OK");
  const body = `# Edison: PayPal Sandbox Results\n\nGenerated: ${new Date().toISOString()}\n\n` +
    `| # | Test | Result | Observation | Private raw evidence |\n|---|---|---|---|---|\n${rows.join("\n")}\n\n` +
    `Plan A technical cycle: ${aReady ? "PASSED" : "INCOMPLETE / FAILED"}.\n\n` +
    `Plan B independent capture/refund cycle: ${bReady ? "PASSED" : "NOT FULLY VERIFIED"}.\n\n` +
    `## Human observations (fill after generating this report)\n\n` +
    `- Buyer approval clicks / seconds: TODO\n- Return to app worked: TODO\n- VOIDED verified in API: TODO\n- Buyer hold release observed (time / balance): TODO\n` +
    `- Search lag: see step 7; pending results are not payment failures.\n- Dispute: list permission alone does not prove create permission.\n` +
    `- Chosen plan: TODO, with evidence and teammate review. No plan is chosen automatically.\n\n` +
    `Credential errors, buyer approval failures and refund failures affect both plans. Diagnose them before switching to B.\n\n` +
    `Raw resource responses are stored locally and ignored by git. Never publish credentials, OAuth tokens or buyer information.\n`;
  await mkdir("docs", { recursive: true });
  await writeFile("docs/SANDBOX-RESULTS.md", body);
  console.log(body);
}
export async function run(args: string[]) {
  const action = args[0] ?? "help";
  const mode = (args[1] ?? "A").toUpperCase() as Mode;
  const state = await load();
  if (action === "report") return report(state);
  if (action === "help") {
    console.log(`Commands:\n  create A|VOID|B|DISPUTE\n  check MODE\n  authorize A|VOID\n  capture A|B|DISPUTE\n  void VOID\n  refund A|B\n  refund-status MODE\n  capture-status MODE\n  search MODE\n  disputes\n  dispute-confirm DISPUTE_ID\n  report\nAll operations use sandbox money. Run one command at a time. State: .local/edison-paypal/.`);
    return;
  }
  let outcome: Outcome = "OK";
  try {
    const paypal = paypalFromEnv();
    if (action === "disputes") {
      const data = await paypal.listDisputes();
      await evidence(state, action, "A", "NOT_TESTED", data, "Disputes read succeeded; creating a buyer dispute remains unverified.");
      console.log(JSON.stringify(data.items?.map(d => ({ id: d.dispute_id, status: d.status })) ?? []));
      return;
    }
    if (action === "dispute-confirm") {
      ensure(args[1], "Supply the dispute ID shown in the sandbox Resolution Center.");
      const data = await paypal.getDispute(args[1]);
      const captureId = state.flows.DISPUTE?.captureId;
      ensure(captureId && data.disputed_transactions?.some(t => t.seller_transaction_id === captureId),
        "The dispute must refer to the DISPUTE flow capture, not an unrelated transaction.");
      await evidence(state, action, "A", "OK", data, `Sandbox buyer dispute ${data.dispute_id} verified against capture ${captureId}.`);
      return;
    }
    ensure(["A", "VOID", "B", "DISPUTE"].includes(mode), "Mode must be A, VOID, B or DISPUTE.");
    if (action === "create") {
      const flow = state.flows[mode] ??= { runId: randomUUID() };
      await save(state); // Persist the stable request ID BEFORE creating an order.
      const origin = new URL(process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
      const intent = mode === "A" || mode === "VOID" ? "AUTHORIZE" : "CAPTURE";
      const order = flow.orderId ? await paypal.getOrder(flow.orderId) : await paypal.createOrder(
        10, "USD", `Mandate Guardian sandbox test ${mode}`, intent, requestIdFor("smoke-create", flow.runId), {
          returnUrl: `${origin}/paypal/return`, cancelUrl: `${origin}/paypal/cancel`,
        });
      ensure(order.id, "No order ID returned.");
      flow.orderId = order.id;
      flow.approveUrl ??= approvalUrl(order);
      ensure(flow.approveUrl, "No approve or payer-action link returned.");
      await evidence(state, action, mode, "OK", order, `${intent} order ${order.id}; status ${order.status}.`);
      console.log(`\nOpen in a browser and approve with your PERSONAL SANDBOX buyer:\n${flow.approveUrl}\nThen run: npm run edison:paypal -- check ${mode}`);
      return;
    }
    const flow = state.flows[mode];
    ensure(flow?.orderId, `Run create ${mode} first.`);
    let data: unknown;
    let detail: string;
    if (action === "check") {
      const order = await paypal.getOrder(flow.orderId);
      data = order;
      outcome = ["APPROVED", "COMPLETED"].includes(order.status) ? "OK" : "PENDING";
      detail = `Buyer check: order ${order.id} is ${order.status}.`;
    } else if (action === "authorize") {
      ensure(mode === "A" || mode === "VOID", "Only AUTHORIZE flows need authorization.");
      let order = await paypal.getOrder(flow.orderId);
      let auth = firstAuthorization(order);
      if (!auth) {
        ensure(order.status === "APPROVED", `Approve the order first; status is ${order.status}.`);
        order = await paypal.authorizeOrder(flow.orderId);
        auth = firstAuthorization(order);
      }
      ensure(auth?.id && auth.status === "CREATED", "Expected a CREATED authorization.");
      flow.authorizationId = auth.id;
      data = order;
      detail = `Authorization ${auth.id}, status ${auth.status}.`;
    } else if (action === "capture") {
      ensure(mode !== "VOID", "Use VOID to test cancellation, not capture.");
      let capture: Payment | undefined;
      const order = await paypal.getOrder(flow.orderId);
      capture = firstCapture(order);
      if (!capture && mode === "A") {
        ensure(flow.authorizationId, "Run authorize A first.");
        capture = await paypal.captureAuthorization(flow.authorizationId);
      } else if (!capture) {
        ensure(order.status === "APPROVED", `Approve first; status is ${order.status}.`);
        capture = firstCapture(await paypal.captureOrder(flow.orderId));
      }
      ensure(capture?.id, "No capture returned.");
      flow.captureId = capture.id;
      flow.capturedAt = capture.create_time ?? flow.capturedAt ?? new Date().toISOString();
      data = capture;
      outcome = capture.status === "COMPLETED" ? "OK" : capture.status === "PENDING" ? "PENDING" : "FAIL";
      detail = `Capture ${capture.id}, status ${capture.status}, amount ${capture.amount?.value} ${capture.amount?.currency_code}.`;
    } else if (action === "void") {
      ensure(flow.authorizationId, "Authorize the VOID order first.");
      const before = await paypal.getAuthorization(flow.authorizationId);
      if (before.status !== "VOIDED") await paypal.voidAuthorization(flow.authorizationId);
      const after = await paypal.getAuthorization(flow.authorizationId);
      data = after;
      outcome = after.status === "VOIDED" ? "OK" : "PENDING";
      detail = `Authorization ${after.id} is ${after.status}. Check buyer hold release separately.`;
    } else if (action === "refund" || action === "refund-status") {
      ensure(flow.captureId, "Capture this flow first.");
      if (action === "refund-status") ensure(flow.refundId, "No refund to check yet.");
      const refund = flow.refundId ? await paypal.getRefund(flow.refundId) : await paypal.refundCapture(flow.captureId);
      flow.refundId = refund.id;
      data = refund;
      outcome = refund.status === "COMPLETED" ? "OK" : refund.status === "PENDING" ? "PENDING" : "FAIL";
      detail = `Refund ${refund.id}, status ${refund.status}.`;
      // Keep status polling in the same report row as the original refund action.
      await evidence(state, "refund", mode, outcome, data, detail);
      return;
    } else if (action === "capture-status") {
      ensure(flow.captureId, "No capture to check.");
      const capture = await paypal.getCapture(flow.captureId);
      outcome = capture.status === "COMPLETED" ? "OK" : capture.status === "PENDING" ? "PENDING" : "FAIL";
      await evidence(state, "capture", mode, outcome, capture, `Capture ${capture.id}, status ${capture.status}.`);
      return;
    } else if (action === "search") {
      ensure(flow.captureId && flow.capturedAt, "Capture this flow first.");
      const data = await paypal.searchTransactions(new Date(Date.parse(flow.capturedAt) - 60_000).toISOString(),
        new Date().toISOString(), flow.captureId);
      const found = data.transaction_details?.some(t => t.transaction_info?.transaction_id === flow.captureId);
      const minutes = ((Date.now() - Date.parse(flow.capturedAt)) / 60_000).toFixed(1);
      await evidence(state, action, mode, found ? "OK" : "PENDING", data,
        `Capture ${flow.captureId} ${found ? "found" : "not yet listed"} after ${minutes} min. This is an observed search time, not an exact indexing time.`);
      return;
    } else throw new Error("Unknown command. Run npm run edison:paypal -- help");
    await evidence(state, action, mode, outcome, data, detail);
    if (outcome === "FAIL") process.exitCode = 1;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await evidence(state, action, ["dispute-confirm", "disputes"].includes(action) ? "A" : mode, "FAIL",
      e instanceof PayPalError ? { status: e.status, debugId: e.debugId, response: e.response } : { error: detail }, detail);
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await run(process.argv.slice(2));
}
