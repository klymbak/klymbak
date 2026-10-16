import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { Attachment } from "@klymbak/client";
import { cx } from "../util";
import { KlIcon } from "./KlIcon";

export interface ComposerProps {
  running?: boolean;
  disabled?: boolean;
  placeholder?: string;
  acceptImages?: boolean;
  onSend?: (text: string, attachments: Attachment[]) => void;
  onStop?: () => void;
  /** Extra controls at the start of the toolbar, such as the model picker. */
  tools?: ReactNode;
}

export interface ComposerHandle {
  focus(): void;
  setText(value: string): void;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { running, disabled, placeholder = "Ask anything, or tell the agent what to do…", acceptImages, onSend, onStop, tools },
  ref,
) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const focusAfterSet = useRef(false);

  const canSend = !disabled && (text.trim().length > 0 || attachments.length > 0);

  // Grow with the text, up to a limit.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
    if (focusAfterSet.current) {
      focusAfterSet.current = false;
      el.focus();
    }
  }, [text]);

  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    setText: (value: string) => {
      focusAfterSet.current = true;
      setText(value);
    },
  }));

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    onSend?.(text, attachments);
    setText("");
    setAttachments([]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
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

  return (
    <form className={cx("kl-composer", running && "kl-composer--running")} onSubmit={submit}>
      {attachments.length > 0 && (
        <div className="kl-composer__files">
          {attachments.map((file, i) => (
            <span key={i} className="kl-composer__file">
              <img src={`data:${file.mimeType};base64,${file.data}`} alt={file.name} />
              <button
                type="button"
                className="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm"
                aria-label={`Remove ${file.name}`}
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
        placeholder={running ? "Add an instruction while the agent works…" : placeholder}
        disabled={disabled}
        aria-label="Message"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      <div className="kl-composer__bar">
        {tools}
        {acceptImages && (
          <button
            type="button"
            className="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm"
            aria-label="Attach an image"
            title="Attach an image"
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
            <KlIcon name="stop" size={12} /> Stop
          </button>
        )}
        <button
          type="submit"
          className="kl-btn kl-btn--primary kl-btn--icon kl-composer__send"
          disabled={!canSend}
          aria-label={running ? "Send instruction" : "Send"}
        >
          <KlIcon name="send" size={16} />
        </button>
      </div>
      {running && (
        <p className="kl-composer__hint">
          The agent is working. Anything you send now is added as an instruction it reads after the current step.
        </p>
      )}
    </form>
  );
});
