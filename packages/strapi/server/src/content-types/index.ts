import conversation from "./conversation/schema.json";
import schedule from "./schedule/schema.json";

export const contentTypes = {
  conversation: { schema: conversation },
  schedule: { schema: schedule },
};

export const CONVERSATION_UID = "plugin::klymbak.conversation";
export const SCHEDULE_UID = "plugin::klymbak.schedule";
