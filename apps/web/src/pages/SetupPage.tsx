import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  CheckCircleIcon,
  CircleIcon,
  CubeIcon,
  EnvelopeIcon,
  KeyIcon,
  PlugsIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { FallbackLogo } from "@/components/FallbackLogo";
import { ApiError, api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type SandboxProviderId = "daytona" | "broker";

/**
 * The two runtimes an agent sandbox can run on. The tradeoff is the point of
 * this step, so both are stated plainly rather than hidden behind a dropdown.
 */
const PROVIDERS: ReadonlyArray<{
  id: SandboxProviderId;
  title: string;
  summary: string;
  points: string[];
}> = [
  {
    id: "daytona",
    title: "Daytona",
    summary: "Managed sandbox VMs. Needs a Daytona API key.",
    points: [
      "Nothing to host — Daytona runs the workspaces",
      "Supports CIDR egress allow lists per agent",
      "Supports archiving idle sandboxes to cold storage",
    ],
  },
  {
    id: "broker",
    title: "Self-hosted broker",
    summary: "Docker containers on your own host, via the private sandbox broker.",
    points: [
      "No third-party account, no per-sandbox ports",
      "Egress is all-or-nothing: blocked, or public internet with private, host, and metadata addresses denied",
      "Shared-kernel Docker/runc isolation — single-tenant use only",
    ],
  },
];

type Form = {
  sandboxProvider: SandboxProviderId;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
  daytonaApiKey: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  openrouterApiKey: string;
  mailgunApiKey: string;
  mailgunDomain: string;
  mailgunSigningKey: string;
  inboundFrom: string;
};

export default function SetupPage({ productName }: { productName: string }) {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<Form>({
    sandboxProvider: "daytona",
    adminEmail: "",
    adminName: "",
    adminPassword: "",
    daytonaApiKey: "",
    anthropicApiKey: "",
    openaiApiKey: "",
    openrouterApiKey: "",
    mailgunApiKey: "",
    mailgunDomain: "",
    mailgunSigningKey: "",
    inboundFrom: "",
  });

  const update = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api("/api/setup", {
        json: {
          sandboxProvider: form.sandboxProvider,
          // Only meaningful for Daytona; the backend rejects an empty key
          // when Daytona is selected and preflights the broker otherwise.
          daytonaApiKey: form.daytonaApiKey || undefined,
          anthropicApiKey: form.anthropicApiKey || undefined,
          openaiApiKey: form.openaiApiKey || undefined,
          openrouterApiKey: form.openrouterApiKey || undefined,
          mailgunApiKey: form.mailgunApiKey || undefined,
          mailgunDomain: form.mailgunDomain || undefined,
          mailgunSigningKey: form.mailgunSigningKey || undefined,
          inboundFrom: form.inboundFrom || undefined,
          admin: {
            email: form.adminEmail,
            name: form.adminName,
            password: form.adminPassword,
          },
        },
      });
      toast.success("Setup complete", {
        description: "Sign in with your new admin account.",
      });
      void navigate("/login");
      window.location.reload();
    } catch (err) {
      toast.error("Setup failed", {
        description: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center text-foreground">
            <FallbackLogo className="size-6" />
          </div>
          <CardTitle>Welcome to {productName}</CardTitle>
          <CardDescription>
            Configure your deployment in one step. You can update these settings later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} id="setup-form">
            <FieldGroup>
              <FieldSet>
                <FieldLegend>
                  <UserIcon
                    className="mr-1.5 inline size-4 text-muted-foreground"
                    weight="duotone"
                  />
                  First admin
                </FieldLegend>
                <FieldDescription>
                  Bootstrap account with full access to the deployment.
                </FieldDescription>
                <Field>
                  <FieldLabel htmlFor="admin-email">Email</FieldLabel>
                  <Input
                    id="admin-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={form.adminEmail}
                    onChange={update("adminEmail")}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="admin-name">Display name</FieldLabel>
                  <Input
                    id="admin-name"
                    autoComplete="name"
                    required
                    value={form.adminName}
                    onChange={update("adminName")}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="admin-password">Password</FieldLabel>
                  <Input
                    id="admin-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={form.adminPassword}
                    onChange={update("adminPassword")}
                  />
                  <FieldDescription>
                    At least 8 characters. You can change it later from your account.
                  </FieldDescription>
                </Field>
              </FieldSet>

              <FieldSeparator />

              <FieldSet>
                <FieldLegend>
                  <CubeIcon
                    className="mr-1.5 inline size-4 text-muted-foreground"
                    weight="duotone"
                  />
                  Sandbox provider
                </FieldLegend>
                <FieldDescription>
                  Where agent sandboxes run. One provider is active for the whole
                  deployment; you can change it later in Settings.
                </FieldDescription>
                <div className="grid gap-3 sm:grid-cols-2">
                  {PROVIDERS.map((provider) => {
                    const selected = form.sandboxProvider === provider.id;
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setForm({ ...form, sandboxProvider: provider.id })}
                        className={`rounded-md border p-3 text-left transition-colors ${
                          selected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted/50"
                        }`}
                      >
                        <span className="flex items-center gap-2 font-medium">
                          {selected ? (
                            <CheckCircleIcon
                              className="size-4 text-primary"
                              weight="fill"
                            />
                          ) : (
                            <CircleIcon className="size-4 text-muted-foreground" />
                          )}
                          {provider.title}
                        </span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {provider.summary}
                        </span>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                          {provider.points.map((point) => (
                            <li key={point}>{point}</li>
                          ))}
                        </ul>
                      </button>
                    );
                  })}
                </div>

                {form.sandboxProvider === "daytona" ? (
                  <Field>
                    <FieldLabel htmlFor="daytona-key">Daytona API key</FieldLabel>
                    <Input
                      id="daytona-key"
                      required
                      value={form.daytonaApiKey}
                      onChange={update("daytonaApiKey")}
                    />
                    <FieldDescription>
                      Stored encrypted. Used to create and resume agent sandboxes.
                    </FieldDescription>
                  </Field>
                ) : (
                  <Alert>
                    <PlugsIcon />
                    <AlertTitle>The broker is configured on the server</AlertTitle>
                    <AlertDescription>
                      Set <code>SANDBOX_BROKER_URL</code> plus{" "}
                      <code>SANDBOX_BROKER_TOKEN</code> (or{" "}
                      <code>SANDBOX_BROKER_TOKEN_FILE</code>) in the deployment
                      environment. Its token never passes through this browser. Setup
                      checks that the broker is reachable and ready before completing — if
                      it is not, nothing is saved and you can pick Daytona instead.
                    </AlertDescription>
                  </Alert>
                )}
              </FieldSet>

              <FieldSeparator />

              <FieldSet>
                <FieldLegend>
                  <KeyIcon
                    className="mr-1.5 inline size-4 text-muted-foreground"
                    weight="duotone"
                  />
                  Model providers
                  <span className="ml-1 text-muted-foreground">(optional)</span>
                </FieldLegend>
                <FieldDescription>
                  Add at least one model-provider key before running agents. You can
                  configure these later in Settings.
                </FieldDescription>
                <Field>
                  <FieldLabel htmlFor="anthropic-key">Anthropic API key</FieldLabel>
                  <Input
                    id="anthropic-key"
                    placeholder="sk-ant-…"
                    value={form.anthropicApiKey}
                    onChange={update("anthropicApiKey")}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="openai-key">OpenAI API key</FieldLabel>
                  <Input
                    id="openai-key"
                    value={form.openaiApiKey}
                    onChange={update("openaiApiKey")}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="openrouter-key">OpenRouter API key</FieldLabel>
                  <Input
                    id="openrouter-key"
                    value={form.openrouterApiKey}
                    onChange={update("openrouterApiKey")}
                  />
                </Field>
              </FieldSet>

              <FieldSeparator />

              <FieldSet>
                <FieldLegend>
                  <EnvelopeIcon
                    className="mr-1.5 inline size-4 text-muted-foreground"
                    weight="duotone"
                  />
                  Mailgun
                  <span className="ml-1 text-muted-foreground">(optional)</span>
                </FieldLegend>
                <FieldDescription>
                  Skip if you don&apos;t need agent email. You can wire it up later in
                  Settings.
                </FieldDescription>
                <Field>
                  <FieldLabel htmlFor="mg-key">API key</FieldLabel>
                  <Input
                    id="mg-key"
                    value={form.mailgunApiKey}
                    onChange={update("mailgunApiKey")}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="mg-domain">Domain</FieldLabel>
                  <Input
                    id="mg-domain"
                    placeholder="mg.example.com"
                    value={form.mailgunDomain}
                    onChange={update("mailgunDomain")}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="mg-signing">Signing key</FieldLabel>
                  <Input
                    id="mg-signing"
                    value={form.mailgunSigningKey}
                    onChange={update("mailgunSigningKey")}
                  />
                  <FieldDescription>
                    HTTP webhook signing key used to verify Mailgun callbacks.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="mg-from">Default From: header</FieldLabel>
                  <Input
                    id="mg-from"
                    placeholder='"Acme Helper" <agent@mg.example.com>'
                    value={form.inboundFrom}
                    onChange={update("inboundFrom")}
                  />
                </Field>
              </FieldSet>

              <Button
                form="setup-form"
                type="submit"
                size="lg"
                className="w-full"
                disabled={submitting}
              >
                {submitting ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <CheckCircleIcon data-icon="inline-start" />
                )}
                {submitting ? "Saving…" : "Complete setup"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
