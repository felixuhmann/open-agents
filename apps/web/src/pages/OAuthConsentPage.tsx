import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ShieldCheckIcon, XIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

export default function OAuthConsentPage({ productName }: { productName: string }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const consentCode = params.get("consent_code");
  const clientId = params.get("client_id");
  const scope = params.get("scope") ?? "openid profile email offline_access";

  const submit = async (accept: boolean) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accept,
          ...(consentCode ? { consent_code: consentCode } : {}),
        }),
      });
      const body = (await res.json()) as { redirectURI?: string; message?: string };
      if (!res.ok) {
        throw new Error(body.message ?? "Consent request failed");
      }
      if (body.redirectURI) {
        window.location.assign(body.redirectURI);
        return;
      }
      toast.error("Consent failed", {
        description: "No redirect returned from the server.",
      });
    } catch (err) {
      toast.error("Consent failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!consentCode || !clientId) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invalid consent request</CardTitle>
            <CardDescription>
              This page is only reachable during an OAuth authorization flow. Start from
              your MCP client (for example Claude Desktop) instead of opening this URL
              directly.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button type="button" variant="outline" onClick={() => void navigate("/")}>
              Go home
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center bg-primary text-primary-foreground">
            <ShieldCheckIcon className="size-4" weight="fill" />
          </div>
          <CardTitle>Authorize MCP access</CardTitle>
          <CardDescription>
            An external client is requesting access to {productName} on your behalf.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-medium">Client</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{clientId}</p>
          </div>
          <div>
            <p className="font-medium">Requested scopes</p>
            <p className="mt-1 text-muted-foreground">{scope}</p>
          </div>
          <p className="text-muted-foreground">
            If you approve, the client can call the same REST API as the web UI using your
            account permissions.
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            className="w-full sm:flex-1"
            disabled={submitting}
            onClick={() => void submit(true)}
          >
            {submitting ? <Spinner data-icon="inline-start" /> : null}
            Allow access
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:flex-1"
            disabled={submitting}
            onClick={() => void submit(false)}
          >
            <XIcon data-icon="inline-start" />
            Deny
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
