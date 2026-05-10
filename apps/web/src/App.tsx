import { Suspense, lazy, type ReactElement } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Spinner } from "@/components/ui/spinner";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { WarningOctagonIcon } from "@phosphor-icons/react";
import {
  canOperateAgents,
  type CurrentUser,
  type UserRole,
  useCurrentUser,
  useSetupStatus,
} from "./lib/queries";

const SetupPage = lazy(() => import("./pages/SetupPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const AgentsListPage = lazy(() => import("./pages/AgentsListPage"));
const AgentDetailPage = lazy(() => import("./pages/AgentDetailPage"));
const AgentEditPage = lazy(() => import("./pages/AgentEditPage"));
const AgentChatPage = lazy(() => import("./pages/AgentChatPage"));
const AgentConversationsPage = lazy(() => import("./pages/AgentConversationsPage"));
const ToolsLibraryPage = lazy(() => import("./pages/ToolsLibraryPage"));
const SkillsLibraryPage = lazy(() => import("./pages/SkillsLibraryPage"));
const IssuesListPage = lazy(() => import("./pages/IssuesListPage"));
const IssueDetailPage = lazy(() => import("./pages/IssueDetailPage"));
const SecretsSettingsPage = lazy(() => import("./pages/SecretsSettingsPage"));
const UsersSettingsPage = lazy(() => import("./pages/UsersSettingsPage"));
const GeneralSettingsPage = lazy(() => import("./pages/GeneralSettingsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));

function canAccessRoute(user: CurrentUser, roles: Array<UserRole> | "operator") {
  if (roles === "operator") return canOperateAgents(user.role);
  return roles.includes(user.role);
}

function RequirePermission({
  user,
  roles,
  children,
}: {
  user: CurrentUser;
  roles: Array<UserRole> | "operator";
  children: ReactElement;
}) {
  if (!canAccessRoute(user, roles)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function ProtectedRoutes() {
  const user = useCurrentUser();
  const location = useLocation();
  if (user.isLoading) return <FullScreenSpinner />;
  if (!user.data) {
    return (
      <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
    );
  }
  return (
    <Layout user={user.data}>
      <Suspense fallback={<FullScreenSpinner />}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/agents" element={<AgentsListPage />} />
          <Route path="/agents/:slug" element={<AgentDetailPage />} />
          <Route
            path="/agents/:slug/edit"
            element={
              <RequirePermission user={user.data} roles="operator">
                <AgentEditPage />
              </RequirePermission>
            }
          />
          <Route path="/agents/:slug/chat" element={<AgentChatPage />} />
          <Route path="/agents/:slug/chat/:conversationId" element={<AgentChatPage />} />
          <Route
            path="/agents/:slug/conversations"
            element={
              <RequirePermission user={user.data} roles="operator">
                <AgentConversationsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/library/tools"
            element={
              <RequirePermission user={user.data} roles="operator">
                <ToolsLibraryPage />
              </RequirePermission>
            }
          />
          <Route
            path="/library/skills"
            element={
              <RequirePermission user={user.data} roles="operator">
                <SkillsLibraryPage />
              </RequirePermission>
            }
          />
          <Route
            path="/issues"
            element={
              <RequirePermission user={user.data} roles="operator">
                <IssuesListPage />
              </RequirePermission>
            }
          />
          <Route
            path="/issues/:id"
            element={
              <RequirePermission user={user.data} roles="operator">
                <IssueDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings/secrets"
            element={
              <RequirePermission user={user.data} roles={["admin"]}>
                <SecretsSettingsPage />
              </RequirePermission>
            }
          />
          <Route path="/settings/profile" element={<ProfilePage />} />
          <Route
            path="/settings/users"
            element={
              <RequirePermission user={user.data} roles={["admin"]}>
                <UsersSettingsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings/general"
            element={
              <RequirePermission user={user.data} roles={["admin"]}>
                <GeneralSettingsPage />
              </RequirePermission>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

export function App() {
  const setup = useSetupStatus();
  const location = useLocation();
  if (setup.isLoading) return <FullScreenSpinner />;
  if (!setup.data) return <FullScreenError message="Backend unreachable" />;
  if (!setup.data.complete && location.pathname !== "/setup") {
    return <Navigate to="/setup" replace />;
  }
  if (setup.data.complete && location.pathname === "/setup") {
    return <Navigate to="/" replace />;
  }
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*" element={<ProtectedRoutes />} />
      </Routes>
    </Suspense>
  );
}

function FullScreenSpinner() {
  return (
    <div className="grid h-screen place-items-center">
      <Spinner className="size-6 text-muted-foreground" />
    </div>
  );
}

function FullScreenError({ message }: { message: string }) {
  return (
    <div className="grid h-screen place-items-center p-6">
      <Empty className="max-w-sm">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WarningOctagonIcon />
          </EmptyMedia>
          <EmptyTitle>Something went wrong</EmptyTitle>
          <EmptyDescription>{message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <p className="text-muted-foreground">
            Check the API server is running and reachable.
          </p>
        </EmptyContent>
      </Empty>
    </div>
  );
}
