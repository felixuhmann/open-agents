import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ChartLineIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  KeyIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
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

type Form = {
  adminEmail: string;
  adminName: string;
  adminPassword: string;
  anthropicApiKey: string;
  mailgunApiKey: string;
  mailgunDomain: string;
  mailgunSigningKey: string;
  inboundFrom: string;
};

export default function SetupPage({ productName }: { productName: string }) {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<Form>({
    adminEmail: "",
    adminName: "",
    adminPassword: "",
    anthropicApiKey: "",
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
          anthropicApiKey: form.anthropicApiKey,
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
          <div className="mb-2 flex size-9 items-center justify-center bg-primary text-primary-foreground">
            <ChartLineIcon className="size-4" weight="fill" />
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
                  <KeyIcon
                    className="mr-1.5 inline size-4 text-muted-foreground"
                    weight="duotone"
                  />
                  Anthropic
                </FieldLegend>
                <FieldDescription>
                  Required. Used to provision agents and run conversations.
                </FieldDescription>
                <Field>
                  <FieldLabel htmlFor="anthropic-key">API key</FieldLabel>
                  <Input
                    id="anthropic-key"
                    required
                    placeholder="sk-ant-…"
                    value={form.anthropicApiKey}
                    onChange={update("anthropicApiKey")}
                  />
                  <FieldDescription>
                    The deployment vault is auto-provisioned the first time you publish an
                    agent with attached capabilities.
                  </FieldDescription>
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
