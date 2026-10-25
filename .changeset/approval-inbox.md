---
"@klymbak/protocol": minor
"@klymbak/server": minor
"@klymbak/client": minor
"@klymbak/react": minor
"@klymbak/vue": minor
"@klymbak/angular": minor
"@klymbak/strapi": minor
---

An approval inbox, and drafted arguments a person can edit before approving.

- `ApprovalInbox` in React, Vue and Angular (`<kl-approval-inbox>`) lists what unattended runs left waiting for the signed-in person, across conversations, oldest first. Each card can be approved, denied with a reason, or edited first, and links to its conversation. `AgentWorkspace` offers it in the sidebar, with a count, while something waits, and so does the Strapi plugin's assistant page.
- The server lists it at `GET /approvals` (`runtime.listApprovals(user)`): approvals in sessions the person can see, for tools their roles may use. A chat's own approvals stay in that chat. A new `approval_decided` notification takes a decided approval out of everyone's inbox.
- A tool's approval can name text arguments the person deciding may change: `edit: ["message"]` or `{ name, label, multiline }`, also from a `preToolUse` hook. The card shows them as fields (`ApprovalView.fields`), `ApprovalDecision.edits` carries the changes, and the call runs with them. The card is marked `edited`, the model is told what changed, and the default card body leaves the editable arguments out. Edits that aren't for a field, aren't text, or that the tool's parameters reject get a 400, and the approval keeps waiting. This works in waiting and in-chat approvals alike.
- The client store keeps `state.inbox` current from notifications, catching up after a reconnect. `decide(approvalId, decision, sessionId?)` decides in a conversation that isn't open, and resolves to whether the decision was recorded.
