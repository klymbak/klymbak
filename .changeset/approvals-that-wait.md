---
"@klymbak/protocol": minor
"@klymbak/server": minor
"@klymbak/client": minor
---

Approvals wait in unattended runs instead of being refused.

- When a scheduled or `runHeadless` run reaches a call that needs approval, the run ends after that step and the call is stored with the session (`pendingApprovals`). Its card shows in the conversation and everyone who can see the session gets an `approval_pending` notification.
- Deciding it through the usual approvals route, hours later or after a restart, resumes the session as a new run. An approved call runs as the person who approved it, so the tool's roles, the policy hooks and the tool see them (`ctx.headless` false); approving takes someone who may use the tool. Denied calls tell the model why, and the model carries on as the run's own user. When one step asks for several approvals, the run resumes once all are decided. New messages in that session get a 409 (`approvals_pending`) until then.
- `ApprovalView.waits` marks such an approval, so the end of its run leaves the card open.
- The client store follows a run that starts in the open conversation elsewhere, so the resumed run streams in.
- Delegated tasks still refuse approvals in unattended runs.
- A session that ran unattended now asks in the moment when a person carries on in it, instead of treating their run as unattended too.
