"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { httpsCallable } from "firebase/functions";
import { doc, onSnapshot, setDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import {
  CheckCircle2,
  ShieldCheck,
  Clock,
  IndianRupee,
  Wallet,
  CreditCard,
  Landmark,
  Smartphone,
  Layers,
  CalendarDays,
  Copy,
  RefreshCw,
  AlertTriangle,
  Link2,
  PlugZap,
  ChevronRight,
  ShieldAlert,
  Loader2,
  Activity,
  Radio,
  CircleDot,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { db, functions } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// ─────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────

// Single document: schools/{schoolId}/config/paymentGateway
// Holds both gateway connection state and payment settings.
interface PaymentGatewayConfig {
  // Gateway connection
  enabled?: boolean;
  connected?: boolean;
  provider?: "razorpay" | "phonepe" | string;
  keyId?: string;
  connectedAt?: Timestamp;
  updatedAt?: Timestamp;
  lastVerifiedAt?: Timestamp;
  lastWebhookAt?: Timestamp;
  lastSuccessfulPaymentAt?: Timestamp;
  webhookActive?: boolean;
  // Payment settings (co-located in the same document)
  allowPartialPayments?: boolean;
  minimumPartialAmount?: number;
  sendWhatsAppReceipt?: boolean;
  sendEmailReceipt?: boolean;
}

// Typed subset used for settings reads/writes.
interface PaymentSettings {
  allowPartialPayments: boolean;
  minimumPartialAmount: number;
  sendWhatsAppReceipt: boolean;
  sendEmailReceipt: boolean;
}

const DEFAULT_SETTINGS: PaymentSettings = {
  allowPartialPayments: false,
  minimumPartialAmount: 500,
  sendWhatsAppReceipt: false,
  sendEmailReceipt: true,
};

interface ConnectGatewayResponse {
  success: boolean;
  provider: string;
  message: string;
}

type ProviderId = "razorpay" | "phonepe" | "cashfree" | "paytm";

const PROVIDER_META: Record<
  ProviderId,
  { name: string; description: string; supports: string[]; initials: string; supported: boolean }
> = {
  razorpay: {
    name: "Razorpay",
    description: "India's leading payment gateway for fee collection at scale.",
    supports: ["UPI", "Cards", "Net Banking"],
    initials: "RP",
    supported: true,
  },
  phonepe: {
    name: "PhonePe",
    description: "Fast UPI-first checkout trusted by parents nationwide.",
    supports: ["UPI", "Cards", "Wallets"],
    initials: "PP",
    supported: true,
  },
  cashfree: {
    name: "Cashfree",
    description: "Reliable settlements with strong reconciliation tools.",
    supports: ["UPI", "Cards", "Net Banking"],
    initials: "CF",
    supported: false,
  },
  paytm: {
    name: "Paytm",
    description: "Widely recognised checkout with broad wallet coverage.",
    supports: ["UPI", "Wallets", "Net Banking"],
    initials: "PT",
    supported: false,
  },
};

// ─────────────────────────────────────────────────────────────────────────
// FIRESTORE HELPERS
// ─────────────────────────────────────────────────────────────────────────

function paymentGatewayRef(schoolId: string) {
  return doc(db, "schools", schoolId, "config", "paymentGateway");
}

async function savePaymentSettings(
  schoolId: string,
  patch: Partial<PaymentSettings>
): Promise<void> {
  await setDoc(
    paymentGatewayRef(schoolId),
    { ...patch, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// ─────────────────────────────────────────────────────────────────────────
// MINIMAL INLINE TOAST
// No new dependency — a small fixed notification shown for 3 s on error.
// ─────────────────────────────────────────────────────────────────────────

interface ToastMsg {
  id: number;
  message: string;
}

function useToast() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const counter = useRef(0);

  const showError = useCallback((message: string) => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  return { toasts, showError };
}

function ToastContainer({ toasts }: { toasts: ToastMsg[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-3 text-sm text-red-700 shadow-lg"
        >
          <XCircle className="h-4 w-4 shrink-0 text-red-500" />
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SMALL UI PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-5 flex flex-col gap-1">
      {eyebrow && (
        <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700/80">
          {eyebrow}
        </span>
      )}
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {description && <p className="text-sm text-slate-500">{description}</p>}
    </div>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  description,
  checked,
  onCheckedChange,
  children,
}: {
  icon?: React.ElementType;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  // Slot for extra UI rendered directly below the label (e.g. minimumPartialAmount)
  children?: React.ReactNode;
}) {
  return (
    <div className="py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {Icon && (
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Icon className="h-4 w-4" />
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-slate-900">{label}</p>
            {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
          </div>
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </div>
      {children}
    </div>
  );
}


// Shows first 8 chars + '...' + last 4 chars. '—' if empty.
// e.g. 'rzp_test_T7x5ep94cMlBij' → 'rzp_test_T7x5...lBij'
function maskKeyId(keyId?: string) {
  if (!keyId) return '—';
  if (keyId.length <= 12) return keyId;
  return `${keyId.slice(0, 8)}...${keyId.slice(-4)}`;
}
function formatDate(ts?: Timestamp) {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatRelativeTime(ts?: Timestamp) {
  if (!ts) return "—";
  const diffMs = Date.now() - ts.toDate().getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

type HealthState = "good" | "bad" | "unknown";

function HealthRow({
  icon: Icon,
  label,
  value,
  state,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  state: HealthState;
}) {
  const dotClass =
    state === "good" ? "bg-emerald-500" : state === "bad" ? "bg-red-500" : "bg-slate-300";
  const valueClass =
    state === "good" ? "text-emerald-700" : state === "bad" ? "text-red-600" : "text-slate-400";

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-sm text-slate-700">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dotClass}`} />
        <span className={`text-sm font-medium ${valueClass}`}>{value}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CONNECT GATEWAY MODAL
// ─────────────────────────────────────────────────────────────────────────

function ConnectGatewayModal({
  providerId,
  open,
  onOpenChange,
  onConnected,
}: {
  providerId: ProviderId | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConnected: () => void;
}) {
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = providerId ? PROVIDER_META[providerId] : null;

  useEffect(() => {
    if (open) {
      setKeyId("");
      setKeySecret("");
      setWebhookSecret("");
      setError(null);
    }
  }, [open, providerId]);

  async function handleSubmit() {
    if (!providerId) return;
    if (!keyId.trim() || !keySecret.trim()) {
      setError("Key ID and Key Secret are both required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const connectPaymentGateway = httpsCallable<
        { provider: string; keyId: string; keySecret: string; webhookSecret?: string },
        ConnectGatewayResponse
      >(functions, "connectPaymentGateway");
      await connectPaymentGateway({
        provider: providerId,
        keyId: keyId.trim(),
        keySecret: keySecret.trim(),
        webhookSecret: webhookSecret.trim() || undefined,
      });
      onOpenChange(false);
      onConnected();
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Failed to connect gateway. Please check your credentials and try again.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {meta?.name ?? "payment provider"}</DialogTitle>
          <DialogDescription>
            Your credentials are verified, then stored securely. EduLink never displays your Key
            Secret again after this step.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="keyId">Key ID</Label>
            <Input
              id="keyId"
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
              placeholder="rzp_live_xxxxxxxxxxxx"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="keySecret">Key Secret</Label>
            <Input
              id="keySecret"
              type="password"
              value={keySecret}
              onChange={(e) => setKeySecret(e.target.value)}
              placeholder="••••••••••••••••"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="webhookSecret">
              Webhook Secret <span className="font-normal text-slate-400">(optional)</span>
            </Label>
            <Input
              id="webhookSecret"
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="••••••••••••••••"
              autoComplete="off"
            />
          </div>
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="gap-2 bg-[#0B1F3A] text-white hover:bg-[#0F2A4A]"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying…
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                Verify &amp; connect
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────

export default function PaymentGatewayPage() {
  const { profile, loading: authLoading } = useAuth();
  const schoolId = profile?.schoolId;
  const { toasts, showError } = useToast();

  // ── Gateway config (paymentGateway doc) ───────────────────────────────
  const [config, setConfig] = useState<PaymentGatewayConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);

  // ── Payment settings (stored in the same paymentGateway doc) ──────────
  const [settings, setSettings] = useState<PaymentSettings>(DEFAULT_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(true);

  const [testAmount, setTestAmount] = useState("10");
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [connectModalProvider, setConnectModalProvider] = useState<ProviderId | null>(null);
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  // ── Listen: paymentGateway (drives both gateway status + settings panel) ─
  // Single listener — gateway config and payment settings live in the same doc.
  useEffect(() => {
    if (!schoolId) {
      setConfigLoading(false);
      setSettingsLoading(false);
      return;
    }
    setConfigLoading(true);
    setSettingsLoading(true);
    const unsub = onSnapshot(
      paymentGatewayRef(schoolId),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as PaymentGatewayConfig;
          setConfig(data);
          setSettings({ ...DEFAULT_SETTINGS, ...(data as unknown as PaymentSettings) });
        } else {
          setConfig(null);
          setSettings(DEFAULT_SETTINGS);
        }
        setConfigLoading(false);
        setSettingsLoading(false);
      },
      (err) => {
        console.error("Failed to load payment gateway config:", err);
        setConfigLoading(false);
        setSettingsLoading(false);
      }
    );
    return () => unsub();
  }, [schoolId]);

  // ── Optimistic toggle helper ──────────────────────────────────────────
  // Immediately applies the new value, writes to Firestore, rolls back on failure.
  async function handleToggle<K extends keyof PaymentSettings>(
    key: K,
    value: PaymentSettings[K]
  ) {
    if (!schoolId) return;
    const previous = settings[key];
    // 1. Optimistic update
    setSettings((prev) => ({ ...prev, [key]: value }));
    // 2. Persist
    try {
      await savePaymentSettings(schoolId, { [key]: value } as Partial<PaymentSettings>);
    } catch (err) {
      // 3. Rollback
      setSettings((prev) => ({ ...prev, [key]: previous }));
      console.error(`Failed to save ${key}:`, err);
      showError("Failed to save setting. Please try again.");
    }
  }

  // minimumPartialAmount is a number field — debounce writes so we don't
  // fire on every keystroke; we write on blur instead.
  async function handleMinimumPartialAmountBlur(raw: string) {
    if (!schoolId) return;
    const parsed = parseInt(raw, 10);
    const value = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    const previous = settings.minimumPartialAmount;
    setSettings((prev) => ({ ...prev, minimumPartialAmount: value }));
    try {
      await savePaymentSettings(schoolId, { minimumPartialAmount: value });
    } catch (err) {
      setSettings((prev) => ({ ...prev, minimumPartialAmount: previous }));
      console.error("Failed to save minimumPartialAmount:", err);
      showError("Failed to save minimum partial amount. Please try again.");
    }
  }

  const isConnected = Boolean(config?.connected);
  const connectedProviderId = (config?.provider as ProviderId | undefined) ?? null;
  const connectedMeta = connectedProviderId ? PROVIDER_META[connectedProviderId] : null;

  const webhookUrl = schoolId
    ? `https://asia-south1-eon-edulink.cloudfunctions.net/paymentWebhook/${schoolId}`
    : "";

  function handleCopyWebhook() {
    if (!webhookUrl) return;
    navigator.clipboard?.writeText(webhookUrl).catch(() => {});
    setWebhookCopied(true);
    setTimeout(() => setWebhookCopied(false), 1800);
  }

  function handleRunTest() {
    setTestRunning(true);
    setTimeout(() => setTestRunning(false), 1600);
  }

  function openConnectModal(providerId: ProviderId) {
    setConnectModalProvider(providerId);
    setConnectModalOpen(true);
  }

  const overviewStats = [
    {
      label: "Provider",
      value: connectedMeta?.name ?? "Not connected",
      icon: Layers,
      tone: "ink" as const,
    },
    {
      label: "Status",
      value: isConnected ? "Connected" : "Not connected",
      icon: ShieldCheck,
      tone: isConnected ? ("emerald" as const) : ("amber" as const),
    },
  ];

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAF8]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-screen bg-[#FAFAF8]">
        {/* ───────────────────────── HEADER ───────────────────────── */}
        <div className="relative overflow-hidden border-b border-slate-200 bg-linear-to-br from-[#0B1F3A] via-[#0F2A4A] to-[#143356]">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage: "radial-gradient(circle at 20% 20%, white 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />
          <div className="relative mx-auto flex max-w-7xl flex-col gap-4 px-6 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-300">
                <Link2 className="h-3.5 w-3.5" />
                Finance &amp; Collections
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Payment Gateway
              </h1>
              <p className="mt-1.5 text-sm text-slate-300">
                Manage online fee collection for your school.
              </p>
            </div>
            <div>
              {configLoading ? (
                <Badge className="gap-1.5 rounded-full border border-slate-400/30 bg-slate-400/10 px-3.5 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-400/10">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking…
                </Badge>
              ) : isConnected ? (
                <Badge className="gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3.5 py-1.5 text-sm font-medium text-emerald-300 hover:bg-emerald-400/10">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Connected
                </Badge>
              ) : (
                <Badge className="gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3.5 py-1.5 text-sm font-medium text-amber-300 hover:bg-amber-400/10">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  Not connected
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl space-y-10 px-6 py-8 sm:px-8">
          {/* ───────────────────────── OVERVIEW CARDS ───────────────────────── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {overviewStats.map((stat) => {
              const Icon = stat.icon;
              const toneClasses =
                stat.tone === "emerald"
                  ? "bg-emerald-50 text-emerald-700"
                  : stat.tone === "amber"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-slate-100 text-slate-700";
              return (
                <Card
                  key={stat.label}
                  className="rounded-xl border-slate-200 shadow-sm transition-shadow hover:shadow-md"
                >
                  <CardContent className="flex items-center justify-between p-5">
                    <div>
                      <p className="text-xs font-medium text-slate-500">{stat.label}</p>
                      <p className="mt-1 text-xl font-semibold text-slate-900">{stat.value}</p>
                    </div>
                    <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${toneClasses}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* ───────────────────────── CONNECTED GATEWAY ───────────────────────── */}
          {isConnected && connectedMeta ? (
            <Card className="rounded-xl border-slate-200 shadow-sm">
              <CardContent className="p-6">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#0B1F3A] text-base font-semibold text-white">
                      {connectedMeta.initials}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-slate-900">
                          {connectedMeta.name}
                        </h3>
                        <Badge className="gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                          <CheckCircle2 className="h-3 w-3" />
                          Healthy
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-sm text-slate-500">
                        Key ID: {maskKeyId(config?.keyId)}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-x-10 gap-y-3 text-sm sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-slate-400">Key ID</p>
                      <p className="mt-0.5 font-mono text-sm font-medium text-slate-700">{maskKeyId(config?.keyId)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Connected since</p>
                      <p className="mt-0.5 font-medium text-slate-700">
                        {formatDate(config?.connectedAt)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Connection status</p>
                      <p className="mt-0.5 font-medium text-emerald-700">Healthy</p>
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" className="gap-2 border-slate-300">
                      <ShieldCheck className="h-4 w-4" />
                      Verify connection
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                      <PlugZap className="h-4 w-4" />
                      Disconnect
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : !configLoading ? (
            <Card className="rounded-xl border-dashed border-slate-300 bg-white shadow-none">
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                  <PlugZap className="h-6 w-6" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900">No gateway connected</h3>
                <p className="max-w-sm text-sm text-slate-500">
                  Connect a provider below to start accepting online fee payments from parents.
                </p>
              </CardContent>
            </Card>
          ) : null}

          {/* ───────────────────────── AVAILABLE PROVIDERS ───────────────────────── */}
          <div>
            <SectionHeading
              title="Available payment providers"
              description="Connect an additional gateway to give parents more ways to pay."
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.keys(PROVIDER_META) as ProviderId[]).map((id) => {
                const meta = PROVIDER_META[id];
                const connected = isConnected && connectedProviderId === id;
                return (
                  <Card
                    key={id}
                    className="group rounded-xl border-slate-200 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <CardContent className="flex h-full flex-col p-5">
                      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-slate-900 text-sm font-semibold text-white">
                        {meta.initials}
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900">{meta.name}</h3>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">
                        {meta.description}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {meta.supports.map((s) => (
                          <span
                            key={s}
                            className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                      <div className="mt-5 pt-1">
                        {connected ? (
                          <Button
                            disabled
                            className="w-full gap-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-50"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Connected
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            className="w-full border-slate-300"
                            disabled={!meta.supported}
                            onClick={() => openConnectModal(id)}
                          >
                            {meta.supported ? "Connect" : "Coming soon"}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* ───────────────────────── GATEWAY HEALTH ───────────────────────── */}
          <div>
            <SectionHeading
              title="Gateway health"
              description="Is your payment gateway working correctly right now?"
            />
            <Card className="rounded-xl border-slate-200 shadow-sm">
              <CardContent className="divide-y divide-slate-100 px-6 py-2">
                <HealthRow
                  icon={Activity}
                  label="Connection status"
                  value={isConnected ? "Connected" : "Not connected"}
                  state={isConnected ? "good" : "bad"}
                />
                <HealthRow
                  icon={ShieldCheck}
                  label="API verification"
                  value={
                    isConnected
                      ? config?.lastVerifiedAt
                        ? "Passed"
                        : "Verified at connect"
                      : "—"
                  }
                  state={isConnected ? "good" : "unknown"}
                />
                <HealthRow
                  icon={Radio}
                  label="Webhook status"
                  value={
                    config?.webhookActive ? "Active" : isConnected ? "Awaiting first event" : "—"
                  }
                  state={config?.webhookActive ? "good" : "unknown"}
                />
                <HealthRow
                  icon={RefreshCw}
                  label="Last webhook received"
                  value={formatRelativeTime(config?.lastWebhookAt)}
                  state={config?.lastWebhookAt ? "good" : "unknown"}
                />
                <HealthRow
                  icon={CircleDot}
                  label="Last successful payment"
                  value={formatRelativeTime(config?.lastSuccessfulPaymentAt)}
                  state={config?.lastSuccessfulPaymentAt ? "good" : "unknown"}
                />
                <HealthRow
                  icon={Clock}
                  label="Settlement cycle"
                  value="T+1"
                  state={isConnected ? "good" : "unknown"}
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* ───────────────────────── FEE COLLECTION SETTINGS ───────────────────────── */}
            <Card className="rounded-xl border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-base">Fee collection settings</CardTitle>
                <CardDescription>Control how payments and receipts behave.</CardDescription>
              </CardHeader>
              <CardContent className="divide-y divide-slate-100 pt-2">
                {settingsLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                  </div>
                ) : (
                  <>
                    {/* Allow partial payments + conditional minimum amount field */}
                    <ToggleRow
                      label="Allow partial payments"
                      description="Parents can pay a portion of the fee due, instead of the full amount."
                      checked={settings.allowPartialPayments}
                      onCheckedChange={(v) => handleToggle("allowPartialPayments", v)}
                    >
                      {settings.allowPartialPayments && (
                        <div className="ml-12 mt-3">
                          <Label
                            htmlFor="minimumPartialAmount"
                            className="text-xs text-slate-500"
                          >
                            Minimum partial amount (₹)
                          </Label>
                          <Input
                            id="minimumPartialAmount"
                            type="number"
                            min={0}
                            defaultValue={settings.minimumPartialAmount}
                            key={settings.minimumPartialAmount} // re-mount if Firestore updates it externally
                            onBlur={(e) => handleMinimumPartialAmountBlur(e.target.value)}
                            className="mt-1.5 w-40 border-slate-300"
                          />
                        </div>
                      )}
                    </ToggleRow>

                    <ToggleRow
                      label="Send WhatsApp receipt"
                      description="Share the receipt with parents over WhatsApp after payment."
                      checked={settings.sendWhatsAppReceipt}
                      onCheckedChange={(v) => handleToggle("sendWhatsAppReceipt", v)}
                    />

                    <ToggleRow
                      label="Send email receipt"
                      description="Email a copy of the receipt to the registered parent email."
                      checked={settings.sendEmailReceipt}
                      onCheckedChange={(v) => handleToggle("sendEmailReceipt", v)}
                    />

                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* ───────────────────────── WEBHOOK ───────────────────────── */}
            <Card className="rounded-xl border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Webhook</CardTitle>
                    <CardDescription>
                      {connectedMeta?.name ?? "Your provider"} uses this URL to notify EduLink of
                      payments.
                    </CardDescription>
                  </div>
                  <Badge
                    className={`gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                      isConnected
                        ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-50"
                        : "bg-slate-100 text-slate-500 hover:bg-slate-100"
                    }`}
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    {isConnected ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-5">
                <Label htmlFor="webhook" className="text-xs text-slate-500">
                  Webhook URL
                </Label>
                <div className="mt-1.5 flex gap-2">
                  <Input
                    id="webhook"
                    readOnly
                    value={webhookUrl || "Connect a gateway to generate a webhook URL"}
                    className="border-slate-300 bg-slate-50 font-mono text-xs text-slate-600"
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0 border-slate-300"
                        onClick={handleCopyWebhook}
                        disabled={!webhookUrl}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{webhookCopied ? "Copied" : "Copy URL"}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0 border-slate-300"
                        disabled={!isConnected}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Regenerate</TooltipContent>
                  </Tooltip>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Regenerating this URL will require updating it in your provider's dashboard.
                </p>
              </CardContent>
            </Card>

            {/* ───────────────────────── CONNECTION TEST ───────────────────────── */}
            <Card className="rounded-xl border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-base">Connection test</CardTitle>
                <CardDescription>
                  Verify your gateway integration is wired correctly — this doesn't move real money.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-5">
                <Label htmlFor="testAmount" className="text-xs text-slate-500">
                  Test amount
                </Label>
                <div className="mt-1.5 flex gap-2">
                  <div className="relative flex-1">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                      ₹
                    </span>
                    <Input
                      id="testAmount"
                      value={testAmount}
                      onChange={(e) => setTestAmount(e.target.value)}
                      className="border-slate-300 pl-7"
                      disabled={!isConnected}
                    />
                  </div>
                  <Button
                    onClick={handleRunTest}
                    disabled={testRunning || !isConnected}
                    className="gap-2 bg-[#0B1F3A] text-white hover:bg-[#0F2A4A]"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {testRunning ? "Verifying…" : "Run connection test"}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  {isConnected
                    ? "Sends a small order-creation request to your provider to confirm credentials and webhook plumbing work end to end."
                    : "Connect a gateway before running a connection test."}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* ───────────────────────── DANGER ZONE ───────────────────────── */}
          <Card className="rounded-xl border-red-200 bg-red-50/40 shadow-sm">
            <CardHeader className="pb-0">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-red-600" />
                <CardTitle className="text-base text-red-700">Danger zone</CardTitle>
              </div>
              <CardDescription className="text-red-600/80">
                These actions affect live fee collection. Proceed carefully.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="space-y-4">
                <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">Disconnect gateway</p>
                      <p className="text-xs text-slate-500">
                        Parents will not be able to pay fees online until a gateway is reconnected.
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    className="shrink-0 gap-2 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                    disabled={!isConnected}
                  >
                    <PlugZap className="h-4 w-4" />
                    Disconnect
                  </Button>
                </div>

              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-center gap-1.5 pb-4 pt-2 text-xs text-slate-400">
            <ChevronRight className="h-3 w-3" />
            All payment data is encrypted and processed by your connected gateway provider.
          </div>
        </div>
      </div>

      <ConnectGatewayModal
        providerId={connectModalProvider}
        open={connectModalOpen}
        onOpenChange={setConnectModalOpen}
        onConnected={() => {
          // onSnapshot will pick up the change automatically; nothing else needed.
        }}
      />

      <ToastContainer toasts={toasts} />
    </TooltipProvider>
  );
}