import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Send, Sparkles, X } from "lucide-react";
import type { FiloLang, FiloMessage } from "@arb/shared";
import { FilobotLogo } from "@/components/FilobotLogo";
import { OTHER_LANG, useLang, type StringKey } from "@/lib/i18n";
import { SERVER_URL } from "@/lib/socket";
import { cn } from "@/lib/utils";

interface Props {
  messages: FiloMessage[];
  onAsk: (text: string, lang: FiloLang) => void;
}

const SUGGESTIONS: StringKey[] = [
  "chat.s.pnl",
  "chat.s.opps",
  "chat.s.latency",
  "chat.s.best",
];

/**
 * Filo: a floating, on-brand chat dock. Filo narrates meaningful events on its
 * own (these arrive as server messages) and answers questions on demand. The
 * panel is bilingual — copy renders in the active language, falling back to the
 * other if a given message only has one (e.g. an LLM reply).
 */
export function FiloChat({ messages, onAsk }: Props) {
  const { lang, t } = useLang();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [lastSeen, setLastSeen] = useState(() => Date.now());
  const [nudge, setNudge] = useState(false);
  const [waLink, setWaLink] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Discover whether the WhatsApp transport is configured on the server.
  useEffect(() => {
    let alive = true;
    fetch(`${SERVER_URL}/api/whatsapp/info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (alive && info?.enabled && info.link) setWaLink(info.link as string);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const NUDGE_KEY = "filo_nudge_seen";

  // Gently prompt first-time visitors to open the chat, once per browser.
  useEffect(() => {
    if (open || localStorage.getItem(NUDGE_KEY) === "1") return;
    const show = setTimeout(() => setNudge(true), 6000);
    return () => clearTimeout(show);
  }, [open]);

  // Auto-dismiss the nudge after a while so it isn't sticky.
  useEffect(() => {
    if (!nudge) return;
    const hide = setTimeout(() => setNudge(false), 11000);
    return () => clearTimeout(hide);
  }, [nudge]);

  // Opening the chat permanently retires the nudge.
  useEffect(() => {
    if (open) {
      setNudge(false);
      localStorage.setItem(NUDGE_KEY, "1");
    }
  }, [open]);

  const dismissNudge = () => {
    setNudge(false);
    localStorage.setItem(NUDGE_KEY, "1");
  };

  // Track whether we're awaiting a reply so we can show a typing indicator.
  const [pending, setPending] = useState(false);
  const answerCount = useMemo(
    () => messages.filter((m) => m.role === "filo" && m.kind === "answer").length,
    [messages],
  );
  const prevAnswers = useRef(answerCount);
  useEffect(() => {
    if (answerCount > prevAnswers.current) setPending(false);
    prevAnswers.current = answerCount;
  }, [answerCount]);

  // Auto-scroll to the newest message.
  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open, pending]);

  // Mark everything seen while the panel is open.
  useEffect(() => {
    if (open) setLastSeen(Date.now());
  }, [open, messages]);

  const unread = open
    ? 0
    : messages.filter((m) => m.role === "filo" && m.ts > lastSeen).length;

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAsk(trimmed, lang);
    setDraft("");
    setPending(true);
  };

  return (
    <>
      {open && (
        <>
          {/* Tap-to-close backdrop (mobile bottom-sheet only) */}
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm sm:hidden"
            onClick={() => setOpen(false)}
          />
          <div className="fixed inset-x-0 bottom-0 z-50 flex h-[85vh] flex-col overflow-hidden rounded-t-2xl border border-white/[0.08] bg-card/95 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:inset-x-auto sm:bottom-[5.5rem] sm:right-4 sm:h-[min(70vh,560px)] sm:w-[380px] sm:rounded-2xl">
          {/* Header */}
          <div className="flex flex-none items-center gap-3 border-b border-white/[0.06] bg-gradient-to-r from-primary/15 to-transparent px-4 py-3">
            <div className="h-8 w-8 drop-shadow-[0_0_12px_hsl(var(--primary)/0.6)]">
              <FilobotLogo />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold tracking-wide">{t("chat.title")}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("chat.subtitle")}
              </div>
            </div>
            <span className="ml-1 flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-profit opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-profit" />
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messages.map((m) => (
              <Bubble key={m.id} msg={m} lang={lang} aiLabel={t("chat.ai")} />
            ))}
            {pending && <Typing label={t("chat.typing")} />}
          </div>

          {/* WhatsApp opt-in (only when the server has the transport configured) */}
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noreferrer"
              className="flex flex-none items-center gap-2.5 border-t border-white/[0.06] bg-[#25D366]/[0.08] px-3 py-2.5 transition-colors hover:bg-[#25D366]/[0.14]"
            >
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#25D366]/20 text-[#25D366]">
                <MessageCircle className="h-4 w-4" />
              </span>
              <span className="leading-tight">
                <span className="block text-[13px] font-semibold text-foreground">
                  {t("chat.whatsapp")}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {t("chat.whatsapp.sub")}
                </span>
              </span>
            </a>
          )}

          {/* Suggestions — always available, never disappear on send */}
          <div className="flex flex-none gap-1.5 overflow-x-auto border-t border-white/[0.06] px-2.5 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SUGGESTIONS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => send(t(key))}
                className="whitespace-nowrap rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {t(key)}
              </button>
            ))}
          </div>

          {/* Composer */}
          <form
            className="flex flex-none items-center gap-2 border-t border-white/[0.06] p-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("chat.placeholder")}
              className="min-w-0 flex-1 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/50"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
              aria-label={t("chat.send")}
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
          </div>
        </>
      )}

      {/* Corner: nudge + launcher (hidden behind the sheet on mobile when open) */}
      <div
        className={cn(
          "fixed bottom-4 right-4 z-50 flex flex-col items-end",
          open && "hidden sm:flex",
        )}
      >
        {/* Nudge: gentle first-visit prompt to open the chat */}
        {nudge && !open && (
        <div className="mb-3 flex max-w-[260px] items-start gap-2 rounded-2xl rounded-br-sm border border-white/[0.1] bg-card/95 px-3 py-2.5 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.6)] backdrop-blur-md">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-left text-[13px] leading-snug text-foreground"
          >
            {t("chat.nudge")}
          </button>
          <button
            type="button"
            onClick={dismissNudge}
            className="-mr-1 -mt-0.5 flex-none text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Launcher */}
      <button
        id="tour-filo"
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative flex h-14 w-14 items-center justify-center rounded-full border border-white/[0.1] bg-card/90 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.6)] backdrop-blur-md transition-transform hover:scale-105",
          open && "scale-95",
        )}
        aria-label={t("chat.open")}
        title={t("chat.open")}
      >
        <div className="h-8 w-8 drop-shadow-[0_0_12px_hsl(var(--primary)/0.6)]">
          <FilobotLogo />
        </div>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-profit px-1 text-[10px] font-bold text-background">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
        </button>
      </div>
    </>
  );
}

function Bubble({
  msg,
  lang,
  aiLabel,
}: {
  msg: FiloMessage;
  lang: FiloLang;
  aiLabel: string;
}) {
  const text = msg.text[lang] ?? msg.text[OTHER_LANG[lang]] ?? "";
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
          {text}
        </div>
      </div>
    );
  }

  const toneRing =
    msg.tone === "good"
      ? "border-profit/30"
      : msg.tone === "warn"
        ? "border-warn/30"
        : msg.tone === "bad"
          ? "border-loss/30"
          : "border-white/[0.06]";

  return (
    <div className="flex items-end gap-2">
      <div className="h-6 w-6 flex-none">
        <FilobotLogo />
      </div>
      <div
        className={cn(
          "max-w-[82%] rounded-2xl rounded-bl-sm border bg-muted/40 px-3 py-2 text-sm leading-relaxed",
          toneRing,
        )}
      >
        {text}
        {msg.ai && (
          <span className="ml-1.5 inline-flex translate-y-[1px] items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="h-2.5 w-2.5" />
            {aiLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function Typing({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-6 w-6 flex-none">
        <FilobotLogo />
      </div>
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm border border-white/[0.06] bg-muted/40 px-3 py-2.5">
        <span className="sr-only">{label}</span>
        <Dot delay="0ms" />
        <Dot delay="150ms" />
        <Dot delay="300ms" />
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70"
      style={{ animationDelay: delay }}
    />
  );
}
