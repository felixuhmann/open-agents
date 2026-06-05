import { Fragment, type ReactNode } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useResolvedPath,
  useMatch,
} from "react-router-dom";
import {
  ChartLineIcon,
  CloudIcon,
  FlowArrowIcon,
  HouseIcon,
  KeyIcon,
  PlugsConnectedIcon,
  PuzzlePieceIcon,
  RobotIcon,
  SignOutIcon,
  SlidersIcon,
  StackIcon,
  UserCircleIcon,
  UsersIcon,
  WarningCircleIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FallbackLogo } from "@/components/FallbackLogo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { authClient } from "@/lib/auth";
import {
  assetSrc,
  canOperateAgents,
  DEFAULT_PRODUCT_NAME,
  type CurrentUser,
  usePublicBranding,
} from "@/lib/queries";
import { Badge } from "./ui/badge";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string; weight?: "regular" | "fill" }>;
  end?: boolean;
};

const NAV_BASE: Array<NavItem> = [
  { to: "/", label: "Dashboard", icon: HouseIcon, end: true },
  { to: "/agents", label: "Agents", icon: RobotIcon },
  { to: "/workflows", label: "Workflows", icon: FlowArrowIcon },
];

const NAV_LIBRARY: Array<NavItem> = [
  { to: "/library/tools", label: "Tools", icon: WrenchIcon },
  { to: "/library/skills", label: "Skills", icon: PuzzlePieceIcon },
  { to: "/library/mcp", label: "MCP", icon: PlugsConnectedIcon },
];

const NAV_REVIEW: Array<NavItem> = [
  { to: "/analytics", label: "Analytics", icon: ChartLineIcon },
  { to: "/issues", label: "Issues", icon: WarningCircleIcon },
];

const NAV_SETTINGS: Array<NavItem> = [
  { to: "/settings/secrets", label: "Secrets", icon: KeyIcon },
  { to: "/settings/sandboxes", label: "Sandboxes", icon: CloudIcon },
  { to: "/settings/users", label: "Users", icon: UsersIcon },
  { to: "/settings/general", label: "General", icon: SlidersIcon },
];

const PATH_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/analytics": "Analytics",
  "/agents": "Agents",
  "/workflows": "Workflows",
  "/library/tools": "Tools",
  "/library/skills": "Skills",
  "/library/mcp": "MCP",
  "/issues": "Issues",
  "/settings/profile": "Profile",
  "/settings/mcp-connection": "MCP connection",
  "/settings/secrets": "Secrets",
  "/settings/sandboxes": "Sandboxes",
  "/settings/users": "Users",
  "/settings/general": "General",
};

type Props = {
  user: CurrentUser;
  children: ReactNode;
};

export function Layout({ user, children }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = user.role === "admin";
  const canManageAgents = canOperateAgents(user.role);
  const branding = usePublicBranding();
  const productName = branding.data?.productName ?? DEFAULT_PRODUCT_NAME;
  const sidebarLogo = assetSrc(branding.data?.sidebarLogoUrl);
  const initials = (user.name ?? user.email).slice(0, 2).toUpperCase();
  const crumbs = buildCrumbs(location.pathname);

  const onSignOut = () => {
    void (async () => {
      await authClient.signOut();
      await navigate("/login");
      window.location.reload();
    })();
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lg" tooltip={productName}>
                <Link to="/" className="flex items-center gap-2">
                  <div className="flex size-10 shrink-0 items-center justify-center text-sidebar-foreground [&_svg]:!size-full">
                    {sidebarLogo ? (
                      <img
                        src={sidebarLogo}
                        alt=""
                        className="size-full object-contain"
                      />
                    ) : (
                      <FallbackLogo />
                    )}
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-heading font-semibold">
                      {productName}
                    </span>
                    <span className="truncate text-xs text-sidebar-foreground/70">
                      agents platform
                    </span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <NavGroup label="Workspace" items={NAV_BASE} />
          {canManageAgents ? (
            <>
              <NavGroup label="Library" items={NAV_LIBRARY} />
              <NavGroup label="Review" items={NAV_REVIEW} />
              {isAdmin ? <NavGroup label="Settings" items={NAV_SETTINGS} /> : null}
            </>
          ) : null}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" tooltip={user.email}>
                    <Avatar className="size-7">
                      <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left leading-tight">
                      <span className="truncate text-xs font-medium">
                        {user.name ?? user.email.split("@")[0]}
                      </span>
                      <span className="truncate text-xs text-sidebar-foreground/70">
                        {user.email}
                      </span>
                    </div>
                    <Badge variant="secondary" className="ml-auto capitalize">
                      {user.role}
                    </Badge>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  align="end"
                  className="min-w-56"
                  sideOffset={8}
                >
                  <DropdownMenuLabel className="flex flex-col gap-0.5">
                    <span className="font-medium">{user.name ?? "Signed in"}</span>
                    <span className="text-xs text-muted-foreground">{user.email}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/settings/profile">
                      <UserCircleIcon data-icon="inline-start" />
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/settings/mcp-connection">
                      <PlugsConnectedIcon data-icon="inline-start" />
                      MCP connection
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onSignOut} variant="destructive">
                    <SignOutIcon data-icon="inline-start" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mx-1 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              {crumbs.map((c, idx) => {
                const isLast = idx === crumbs.length - 1;
                return (
                  <Fragment key={c.to}>
                    {idx > 0 ? <BreadcrumbSeparator /> : null}
                    <BreadcrumbItem>
                      {isLast ? (
                        <BreadcrumbPage>{c.label}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink asChild>
                          <Link to={c.to}>{c.label}</Link>
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function NavGroup({ label, items }: { label: string; items: Array<NavItem> }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>
        <StackIcon className="mr-1.5 size-3" />
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <NavMenuItem key={item.to} item={item} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function NavMenuItem({ item }: { item: NavItem }) {
  const resolved = useResolvedPath(item.to);
  const match = useMatch({ path: resolved.pathname, end: item.end ?? false });
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={Boolean(match)} tooltip={item.label}>
        <Link to={item.to}>
          <item.icon className="size-4" />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function buildCrumbs(pathname: string) {
  const out: Array<{ to: string; label: string }> = [{ to: "/", label: "Home" }];
  if (pathname === "/") return out;
  const parts = pathname.split("/").filter(Boolean);
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    const label =
      PATH_LABELS[acc] ??
      (part.length <= 24 ? part : `${part.slice(0, 21)}…`).replace(/-/g, " ");
    out.push({ to: acc, label });
  }
  return out;
}
