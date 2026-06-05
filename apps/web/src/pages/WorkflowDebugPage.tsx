import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  ClipboardIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { WorkflowTracePanel } from "@/components/WorkflowTraceView";
import { PageHeader } from "@/components/PageHeader";
import {
  canOperateAgents,
  useCurrentUser,
  useWorkflowConversationTrace,
} from "@/lib/queries";
import { buildWorkflowTraceExport } from "@/lib/workflowTraceExport";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function WorkflowDebugPage() {
  const { slug, conversationId } = useParams<{
    slug: string;
    conversationId: string;
  }>();
  const me = useCurrentUser();
  const trace = useWorkflowConversationTrace(conversationId);

  if (me.data && !canOperateAgents(me.data.role)) {
    return <Navigate to="/" replace />;
  }

  if (trace.isLoading || !trace.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const data = trace.data;
  const backHref =
    slug && conversationId ? `/workflows/${slug}/chat/${conversationId}` : "/workflows";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link to={backHref}>
            <ArrowLeftIcon data-icon="inline-start" />
            Back to chat
          </Link>
        </Button>
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              <TerminalWindowIcon className="size-6" />
              Workflow debug trace
            </span>
          }
          description={`${data.workflow.displayName} · ${data.session.label}`}
          actions={
            <CopyButton
              label="Copy compact trace (JSON)"
              value={JSON.stringify(buildWorkflowTraceExport(data), null, 2)}
            />
          }
        />
      </div>

      <WorkflowTracePanel data={data} />
    </div>
  );
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error("Couldn't copy", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };
  return (
    <Button type="button" size="sm" variant="outline" onClick={onClick}>
      {copied ? (
        <CheckCircleIcon data-icon="inline-start" />
      ) : (
        <ClipboardIcon data-icon="inline-start" />
      )}
      {label}
    </Button>
  );
}
