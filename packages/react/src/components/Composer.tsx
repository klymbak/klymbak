import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { McpCompleteRequest, McpPromptInfo, McpResourceInfo, McpResourceTemplateInfo } from "@klymbak/protocol";
import {
  createSuggester,
  findMention,
  insertMention,
  mentionKey,
  mentionOptions,
  promptFields,
  promptLabel,
  promptReady,
  removeMention,
  templateFields,
  templateReady,
  type Attachment,
  type McpReferences,
  type MentionOption,
  type ReferenceFields,
} from "@klymbak/client";
import { useI18n } from "../context";
import { cx } from "../util";
import { KlIcon } from "./KlIcon";

export interface ComposerProps {
  running?: boolean;
  disabled?: boolean;
  placeholder?: string;
  acceptImages?: boolean;
  /** MCP resources to offer after @. */
  resources?: McpResourceInfo[];
  /** MCP resource templates to offer after @, each asking for its variables. */
  resourceTemplates?: McpResourceTemplateInfo[];
  /** MCP prompts to offer after / at the start of the message. */
  prompts?: McpPromptInfo[];
  /** Where suggestions for a prompt's arguments and a template's variables come from. */
  complete?: (request: McpCompleteRequest) => Promise<string[]>;
  onSend?: (text: string, attachments: Attachment[], references: McpReferences) => void;
  onStop?: () => void;
  /** Extra controls at the start of the toolbar, such as the model picker. */
  tools?: ReactNode;
}

export interface ComposerHandle {
  focus(): void;
  setText(value: string): void;
}

interface Templated {
  id: number;
  template: McpResourceTemplateInfo;
  values: Record<string, string>;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { running, disabled, placeholder, acceptImages, resources, resourceTemplates, prompts, complete, onSend, onStop, tools },
  ref,
) {
  const i18n = useI18n();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mentioned, setMentioned] = useState<McpResourceInfo[]>([]);
  /** Resources from templates, each waiting for its values. */
  const [templated, setTemplated] = useState<Templated[]>([]);
  const [prompt, setPrompt] = useState<McpPromptInfo>();
  const [values, setValues] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const focusAfterSet = useRef(false);
  /** Where the caret goes once the text changed by choosing from the menu has rendered. */
  const caretAfterSet = useRef<number | undefined>(undefined);
  /** The group of fields whose first one takes the focus once it has rendered. */
  const [focusFields, setFocusFields] = useState<string>();
  const nextTemplateId = useRef(0);

  // The @ and / menu follows the caret while the box has focus.
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  /** Where a mention closed with Escape starts: its menu stays closed until another one begins. */
  const [dismissed, setDismissed] = useState<number>();
  const [highlight, setHighlight] = useState({ key: "", index: 0 });
  const menuId = useId();

  const mention = focused && !running && !disabled ? findMention(text, caret) : undefined;
  const menuKey = mention ? `${mention.start}:${mention.query}` : "";
  const options =
    mention && mention.start !== dismissed ? mentionOptions(mention, { resources, resourceTemplates, prompts }, { resources: mentioned, prompt }) : [];
  const active = highlight.key === menuKey ? Math.min(highlight.index, options.length - 1) : 0;

  /** The values a chosen prompt and each templated resource ask for, one group of fields each. */
  const groups: { key: string; fields: ReferenceFields; values: Record<string, string>; set(name: string, value: string): Record<string, string> }[] = [
    ...(prompt?.arguments.length
      ? [
          {
            key: "prompt",
            fields: promptFields(prompt),
            values,
            set: (name: string, value: string) => {
              const next = { ...values, [name]: value };
              setValues(next);
              return next;
            },
          },
        ]
      : []),
    ...templated.map((entry) => ({
      key: `t${entry.id}`,
      fields: templateFields(entry.template),
      values: entry.values,
      set: (name: string, value: string) => {
        const next = { ...entry.values, [name]: value };
        setTemplated((current) => current.map((other) => (other.id === entry.id ? { ...other, values: next } : other)));
        return next;
      },
    })),
  ];

  // Suggestions for the field being typed into, from the server, as a datalist.
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
  const completeRef = useRef(complete);
  completeRef.current = complete;
  const [suggester] = useState(() =>
    createSuggester(
      (request) => completeRef.current?.(request) ?? Promise.resolve([]),
      (key, found) => setSuggestions((current) => ({ ...current, [key]: found })),
    ),
  );
  useEffect(() => () => suggester.dispose(), [suggester]);

  function suggest(group: (typeof groups)[number], name: string, current = group.values) {
    if (group.fields.completes && complete) suggester.ask(`${group.key}:${name}`, group.fields.request(name, current));
  }

  const canSend =
    !disabled &&
    (!prompt || promptReady(prompt, values)) &&
    templated.every((entry) => templateReady(entry.template, entry.values)) &&
    Boolean(text.trim() || attachments.length || mentioned.length || templated.length || prompt);

  // Grow with the text, up to a limit.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
    if (caretAfterSet.current !== undefined) {
      el.setSelectionRange(caretAfterSet.current, caretAfterSet.current);
      caretAfterSet.current = undefined;
    }
    if (focusAfterSet.current) {
      focusAfterSet.current = false;
      el.focus();
    }
  }, [text]);

  // The values of a prompt or template come first once it's chosen.
  useLayoutEffect(() => {
    if (!focusFields) return;
    form.current?.querySelector<HTMLInputElement>(`[data-fields="${focusFields}"] input`)?.focus();
    setFocusFields(undefined);
  }, [focusFields]);

  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    setText: (value: string) => {
      focusAfterSet.current = true;
      setText(value);
    },
  }));

  /** Follows the text and caret; a mention that's gone takes its dismissal with it. */
  function track(value: string, at: number) {
    setText(value);
    setCaret(at);
    if (findMention(value, at)?.start !== dismissed) setDismissed(undefined);
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    onSend?.(text, attachments, {
      resources: mentioned,
      templates: templated.map(({ template, values }) => ({ template, values })),
      prompt,
      arguments: values,
    });
    setText("");
    setAttachments([]);
    setMentioned([]);
    setTemplated([]);
    setPrompt(undefined);
    setValues({});
  }

  function choose(option: MentionOption) {
    if (!mention) return;
    let edit: { text: string; caret: number };
    if (option.resource) {
      const resource = option.resource;
      setMentioned((current) => [...current, resource]);
      edit = insertMention(text, mention, resource.name);
    } else if (option.template) {
      const entry = { id: nextTemplateId.current++, template: option.template, values: {} };
      setTemplated((current) => [...current, entry]);
      setFocusFields(`t${entry.id}`);
      edit = insertMention(text, mention, option.template.name);
    } else {
      setPrompt(option.prompt);
      setValues({});
      if (option.prompt?.arguments.length) setFocusFields("prompt");
      edit = removeMention(text, mention);
    }
    caretAfterSet.current = edit.caret;
    track(edit.text, edit.caret);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (options.length && !event.shiftKey && !event.nativeEvent.isComposing) {
      const action = mentionKey(event.key, active, options.length);
      if (action !== undefined) {
        event.preventDefault();
        if (action === "choose") choose(options[active]!);
        else if (action === "close") setDismissed(mention!.start);
        else setHighlight({ key: menuKey, index: action });
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function removePrompt() {
    setPrompt(undefined);
    setValues({});
    input.current?.focus();
  }

  function fieldLabel(field: ReferenceFields["fields"][number]) {
    return field.required ? field.label : i18n.t("composer.optional", { name: field.label });
  }

  async function addFiles(files: FileList | File[]) {
    const added: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) continue;
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      added.push({ name: file.name, mimeType: file.type, data });
    }
    if (added.length) setAttachments((current) => [...current, ...added]);
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (!acceptImages) return;
    const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      event.preventDefault();
      void addFiles(files);
    }
  }

  const menuLabel = i18n.t(mention?.kind === "prompt" ? "composer.prompts" : "composer.resources");
  const removeButton = (name: string, onClick: () => void) => (
    <button type="button" className="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm" aria-label={i18n.t("composer.removeFile", { name })} onClick={onClick}>
      <KlIcon name="close" size={10} />
    </button>
  );

  return (
    <form ref={form} className={cx("kl-composer", running && "kl-composer--running")} onSubmit={submit}>
      {options.length > 0 && (
        <div id={menuId} className="kl-mention-menu kl-scroll" role="listbox" aria-label={menuLabel}>
          <span className="kl-mention-menu__title" aria-hidden="true">
            {menuLabel}
          </span>
          {options.map((option, i) => (
            <div
              key={option.key}
              id={`${menuId}-${i}`}
              role="option"
              className={cx("kl-mention-menu__option", i === active && "kl-mention-menu__option--active")}
              aria-selected={i === active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setHighlight({ key: menuKey, index: i })}
              onClick={() => choose(option)}
            >
              <KlIcon name={option.prompt ? "chat" : option.template ? "database" : "file"} size={14} />
              <span className="kl-mention-menu__text">
                <span className="kl-mention-menu__name">{option.name}</span>
                {option.detail && <span className="kl-mention-menu__detail">{option.detail}</span>}
              </span>
              <span className="kl-mention-menu__server">{option.server}</span>
            </div>
          ))}
        </div>
      )}
      {(prompt || mentioned.length > 0 || templated.length > 0) && (
        <div className="kl-composer__refs">
          {prompt && (
            <span className="kl-ref kl-ref--prompt" title={prompt.description}>
              <KlIcon name="chat" size={12} />
              <span className="kl-ref__name">/{promptLabel(prompt)}</span>
              {removeButton(promptLabel(prompt), removePrompt)}
            </span>
          )}
          {mentioned.map((resource, i) => (
            <span key={`${resource.server}:${resource.uri}`} className="kl-ref" title={resource.uri}>
              <KlIcon name="file" size={12} />
              <span className="kl-ref__name">{resource.name}</span>
              {removeButton(resource.name, () => setMentioned((current) => current.filter((_, j) => j !== i)))}
            </span>
          ))}
          {templated.map((entry) => (
            <span key={entry.id} className="kl-ref" title={entry.template.uriTemplate}>
              <KlIcon name="database" size={12} />
              <span className="kl-ref__name">{entry.template.name}</span>
              {removeButton(entry.template.name, () => setTemplated((current) => current.filter((other) => other.id !== entry.id)))}
            </span>
          ))}
        </div>
      )}
      {groups.map((group) => (
        <div
          key={group.key}
          className="kl-composer__args"
          role="group"
          data-fields={group.key}
          aria-label={i18n.t("composer.promptValues", { name: group.fields.label })}
        >
          {groups.length > 1 && (
            <span className="kl-composer__args-label" aria-hidden="true">
              {group.fields.label}
            </span>
          )}
          {group.fields.fields.map((field, i) => {
            const list = group.fields.completes && complete ? `${menuId}-${group.key}-${i}` : undefined;
            return [
              <input
                key={field.name}
                className="kl-input kl-composer__arg"
                value={group.values[field.name] ?? ""}
                placeholder={fieldLabel(field)}
                aria-label={fieldLabel(field)}
                title={field.description}
                required={field.required}
                list={list}
                autoComplete="off"
                onChange={(event) => suggest(group, field.name, group.set(field.name, event.target.value))}
                onFocus={() => suggest(group, field.name)}
              />,
              list && (
                <datalist key={`${field.name}-list`} id={list}>
                  {(suggestions[`${group.key}:${field.name}`] ?? []).map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              ),
            ];
          })}
        </div>
      ))}
      {attachments.length > 0 && (
        <div className="kl-composer__files">
          {attachments.map((file, i) => (
            <span key={i} className="kl-composer__file">
              <img src={`data:${file.mimeType};base64,${file.data}`} alt={file.name} />
              <button
                type="button"
                className="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm"
                aria-label={i18n.t("composer.removeFile", { name: file.name })}
                onClick={() => setAttachments((current) => current.filter((_, j) => j !== i))}
              >
                <KlIcon name="close" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={input}
        className="kl-composer__input"
        rows={1}
        value={text}
        placeholder={running ? i18n.t("composer.placeholderRunning") : (placeholder ?? i18n.t("composer.placeholder"))}
        disabled={disabled}
        aria-label={i18n.t("composer.label")}
        aria-autocomplete={resources?.length || resourceTemplates?.length || prompts?.length ? "list" : undefined}
        aria-controls={options.length ? menuId : undefined}
        aria-activedescendant={options.length ? `${menuId}-${active}` : undefined}
        onChange={(event) => track(event.target.value, event.target.selectionStart)}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      <div className="kl-composer__bar">
        {tools}
        {acceptImages && (
          <button
            type="button"
            className="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm"
            aria-label={i18n.t("composer.attachImage")}
            title={i18n.t("composer.attachImage")}
            onClick={() => fileInput.current?.click()}
          >
            <KlIcon name="image" size={15} />
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            void addFiles(event.target.files ?? []);
            event.target.value = "";
          }}
        />
        <span className="kl-composer__spacer" />
        {running && (
          <button type="button" className="kl-btn kl-btn--sm" onClick={onStop}>
            <KlIcon name="stop" size={12} /> {i18n.t("composer.stop")}
          </button>
        )}
        <button
          type="submit"
          className="kl-btn kl-btn--primary kl-btn--icon kl-composer__send"
          disabled={!canSend}
          aria-label={i18n.t(running ? "composer.sendInstruction" : "composer.send")}
        >
          <KlIcon name="send" size={16} />
        </button>
      </div>
      {running && <p className="kl-composer__hint">{i18n.t("composer.runningHint")}</p>}
    </form>
  );
});
