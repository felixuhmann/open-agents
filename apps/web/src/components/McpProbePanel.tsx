import type { McpProbeResult, McpProbeStatus } from "@open-agents/types";
import {
  CheckCircleIcon,
  PlugsConnectedIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const STATUS_LABEL: Record<McpProbeStatus, string> = {
  connected: "Connected",
  auth_failure: "Auth failed",
  unreachable: "Unreachable",
  timeout: "Timed out",
  protocol_error: "Protocol error",
  error: "Error",
};

const STATUS_VARIANT: Record<
  McpProbeStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  connected: "default",
  auth_failure: "destructive",
  unreachable: "destructive",
  timeout: "secondary",
  protocol_error: "secondary",
  error: "destructive",
};

export function McpProbeStatusBadge({
  result,
  pending,
}: {
  result?: McpProbeResult | null;
  pending?: boolean;
}) {
  if (pending) {
    return (
      <Badge variant="outline" className="gap-1">
        <Spinner className="size-3" />
        Checking…
      </Badge>
    );
  }
  if (!result) {
    return <Badge variant="outline">Not checked</Badge>;
  }
  return (
    <Badge variant={STATUS_VARIANT[result.status]}>{STATUS_LABEL[result.status]}</Badge>
  );
}

function ProbeIcon({ status }: { status: McpProbeStatus }) {
  if (status === "connected") {
    return <CheckCircleIcon className="text-emerald-600" />;
  }
  if (status === "auth_failure" || status === "unreachable" || status === "error") {
    return <XCircleIcon className="text-destructive" />;
  }
  return <WarningCircleIcon className="text-amber-600" />;
}

export function McpProbeResultPanel({
  result,
  onRetest,
  retestPending,
}: {
  result: McpProbeResult;
  onRetest?: () => void;
  retestPending?: boolean;
}) {
  const diagnostics = result.diagnostics;

  return (
    <div className="flex flex-col gap-3">
      <Alert variant={result.ok ? "default" : "destructive"}>
        <ProbeIcon status={result.status} />
        <AlertTitle className="flex flex-wrap items-center gap-2">
          {STATUS_LABEL[result.status]}
          {result.latencyMs !== undefined ? (
            <span className="font-normal text-muted-foreground">
              {result.latencyMs} ms
            </span>
          ) : null}
        </AlertTitle>
        <AlertDescription>{result.message}</AlertDescription>
        {onRetest ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            disabled={retestPending}
            onClick={onRetest}
          >
            {retestPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <PlugsConnectedIcon />
            )}
            Test again
          </Button>
        ) : null}
      </Alert>

      {diagnostics ? (
        <dl className="grid gap-1.5 rounded-none border px-2.5 py-2 text-xs">
          {diagnostics.authProvided !== undefined ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Bearer sent</dt>
              <dd>{diagnostics.authProvided ? "Yes" : "No"}</dd>
            </div>
          ) : null}
          {diagnostics.authRequired ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Auth required</dt>
              <dd className="text-destructive">Yes</dd>
            </div>
          ) : null}
          {diagnostics.httpStatus !== undefined ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">HTTP status</dt>
              <dd className="font-mono">{diagnostics.httpStatus}</dd>
            </div>
          ) : null}
          {diagnostics.serverName ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Server</dt>
              <dd className="font-mono">
                {diagnostics.serverName}
                {diagnostics.serverVersion ? `@${diagnostics.serverVersion}` : ""}
              </dd>
            </div>
          ) : null}
          {diagnostics.protocolVersion ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Protocol</dt>
              <dd className="font-mono">{diagnostics.protocolVersion}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {result.tools && result.tools.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium">
            Discovered tools ({result.toolCount ?? result.tools.length})
          </p>
          <Accordion type="multiple" className="rounded-none border px-2">
            {result.tools.map((tool) => (
              <AccordionItem key={tool.name} value={tool.name}>
                <AccordionTrigger className="font-mono text-xs">
                  {tool.name}
                </AccordionTrigger>
                <AccordionContent>
                  {tool.description ? (
                    <p className="text-muted-foreground">{tool.description}</p>
                  ) : (
                    <p className="text-muted-foreground">No description.</p>
                  )}
                  {tool.inputSchema ? (
                    <pre className="mt-2 max-h-40 overflow-auto rounded-none bg-muted/50 p-2 font-mono text-[10px]">
                      {JSON.stringify(tool.inputSchema, null, 2)}
                    </pre>
                  ) : null}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      ) : result.ok ? (
        <p className="text-xs text-muted-foreground">
          Server connected but returned no tools.
        </p>
      ) : null}
    </div>
  );
}
