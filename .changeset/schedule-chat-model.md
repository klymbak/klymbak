---
"@klymbak/server": patch
"@klymbak/protocol": patch
---

A task scheduled from chat runs on the conversation's model. Before, `schedule_task` dropped the model and every run fell back to the default.

- `schedule_task` takes an optional `model` ("provider/model-id") for when the person names one. Left out, the task keeps the conversation's model, unless its specialist has a model of its own. The created card and the tool's reply say which model it is.
- `CreateScheduleRequest.model` and `ScheduleInfo.model`: `POST /schedules` accepts a model, checked against the server's models (a 400 when it isn't one), and schedules list theirs.
