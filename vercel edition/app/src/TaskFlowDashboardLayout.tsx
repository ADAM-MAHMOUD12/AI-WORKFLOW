import { useEffect, useState, type ReactNode, type RefObject } from "react";
import {
  BrainCircuit,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { translate } from "./localization";
import GlassAppearanceControl from "./GlassAppearanceControl";

// Adapted from the reusable BaseLayout and AppSidebar components in
// shadcnstore/shadcn-dashboard-landing-template (MIT), pinned in THIRD_PARTY_NOTICES.md.
export type Page =
  | "Overview"
  | "Projects"
  | "Flowchart"
  | "AI Chat"
  | "Speaking Trainer"
  | "Skills"
  | "Design"
  | "Architectural Plan"
  | "Motion Graphics"
  | "Programming"
  | "Content Editing"
  | "AI TaskFlow 3D"
  | "AI Planner"
  | "Markdown"
  | "Static Web"
  | "AI Providers"
  | "Settings";

export type DashboardNavItem = { label: Page; icon: LucideIcon };
export type DashboardWorkspace = {
  id: string;
  name: string;
  data: { projects?: readonly unknown[]; tasks?: readonly unknown[] };
};
export type DashboardProfile = { name: string; email: string };

type Props<TWorkspace extends DashboardWorkspace = DashboardWorkspace> = {
  page: Page;
  navItems: DashboardNavItem[];
  language: "ar" | "en";
  compactMode: boolean;
  t: (text: string) => string;
  activeWorkspace: TWorkspace | undefined;
  workspaces: TWorkspace[];
  workspaceSwitcher: RefObject<HTMLDivElement | null>;
  showWorkspaceMenu: boolean;
  onToggleWorkspaceMenu: () => void;
  onCloseWorkspaceMenu: () => void;
  onSwitchWorkspace: (workspace: TWorkspace) => void;
  creatingWorkspace: boolean;
  onStartWorkspaceCreation: () => void;
  onCancelWorkspaceCreation: () => void;
  workspaceNameInput: string;
  onWorkspaceNameChange: (value: string) => void;
  onCreateWorkspace: () => void;
  profile: DashboardProfile;
  search: string;
  onSearchChange: (value: string) => void;
  onNavigate: (page: Page) => void;
  onOpenHelp: () => void;
  onOpenProfile: () => void;
  onOpen3DLauncher: () => void;
  canOpen3D: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  children: ReactNode;
  overlays?: ReactNode;
};

const pageLabels: Record<Page, string> = {
  Overview: "نظرة عامة",
  Projects: "المشاريع",
  Flowchart: "مخطط التدفق",
  "AI Chat": "محادثة AI",
  "Speaking Trainer": "مدرّب المحادثة",
  Design: "التصميم",
  "Architectural Plan": "المخطط المعماري",
  "Motion Graphics": "موشن جرافيك",
  Programming: "البرمجة",
  "Content Editing": "مونتاج المحتوى",
  "AI TaskFlow 3D": "AI TaskFlow 3D",
  Skills: "المهارات",
  "AI Planner": "منظّم ذكي",
  Markdown: "مستند Markdown",
  "Static Web": "محرر ويب ثابت",
  "AI Providers": "مزوّدو الذكاء الاصطناعي",
  Settings: "الإعدادات",
};

function localizedPageLabel(page: Page, language: "ar" | "en") {
  if (language === "en" && page === "Speaking Trainer") return "Speaking Trainer";
  return translate(pageLabels[page], language);
}

const navGroups: { label: string; englishLabel: string; pages: Page[] }[] = [
  { label: "مساحة العمل", englishLabel: "Workspace", pages: ["Overview", "Projects", "Flowchart", "Markdown", "Static Web"] },
  {
    label: "استوديو AI",
    englishLabel: "AI Studio",
    pages: ["AI Chat", "Programming", "Content Editing", "Speaking Trainer", "Design", "Architectural Plan", "Motion Graphics", "Skills", "AI Planner"],
  },
  { label: "إدارة", englishLabel: "Administration", pages: ["AI Providers", "Settings"] },
];

function SidebarNavGroup({
  label,
  englishLabel,
  pages,
  navItems,
  page,
  language,
  onNavigate,
  onClose,
}: {
  label: string;
  englishLabel: string;
  pages: Page[];
  navItems: DashboardNavItem[];
  page: Page;
  language: "ar" | "en";
  onNavigate: (page: Page) => void;
  onClose: () => void;
}) {
  const items = navItems.filter((item) => pages.includes(item.label));
  if (!items.length) return null;

  return (
    <section className="taskflow-nav-group" aria-label={language === "ar" ? label : englishLabel}>
      <h2>{language === "ar" ? label : englishLabel}</h2>
      <nav>
        {items.map(({ label: itemLabel, icon: Icon }) => (
          <button
            type="button"
            key={itemLabel}
            className={`taskflow-nav-item${page === itemLabel ? " is-active" : ""}`}
            aria-current={page === itemLabel ? "page" : undefined}
            onClick={() => {
              onNavigate(itemLabel);
              onClose();
            }}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{localizedPageLabel(itemLabel, language)}</span>
          </button>
        ))}
      </nav>
    </section>
  );
}

function AppSidebar<TWorkspace extends DashboardWorkspace>({
  page,
  navItems,
  language,
  t,
  activeWorkspace,
  workspaces,
  workspaceSwitcher,
  showWorkspaceMenu,
  onToggleWorkspaceMenu,
  onCloseWorkspaceMenu,
  onSwitchWorkspace,
  creatingWorkspace,
  onStartWorkspaceCreation,
  onCancelWorkspaceCreation,
  workspaceNameInput,
  onWorkspaceNameChange,
  onCreateWorkspace,
  profile,
  onNavigate,
  onOpenProfile,
  onToggleSidebar,
  sidebarCollapsed,
  onOpen3DLauncher,
  canOpen3D,
  mobileOpen,
}: Props<TWorkspace> & { mobileOpen: boolean }) {
  return (
    <aside className={`taskflow-sidebar${mobileOpen ? " is-open" : ""}`} data-slot="sidebar">
      <div className="taskflow-sidebar-header" data-slot="sidebar-header">
        <div className="taskflow-brand">
          <span className="taskflow-brand-mark"><BrainCircuit size={21} aria-hidden="true" /></span>
          <span className="taskflow-brand-copy">
            <strong>AI TaskFlow</strong>
            <small>SMART WORKSPACE</small>
          </span>
        </div>

        <div className="taskflow-workspace-switcher" ref={workspaceSwitcher}>
          <button
            type="button"
            className="taskflow-workspace-picker"
            aria-haspopup="menu"
            aria-expanded={showWorkspaceMenu}
            onClick={onToggleWorkspaceMenu}
          >
            <span className="taskflow-workspace-avatar">{activeWorkspace?.name.trim().charAt(0) || "A"}</span>
            <span className="taskflow-workspace-copy">
              <strong>{activeWorkspace?.name ?? t("مساحة عملي")}</strong>
              <small>
                {activeWorkspace?.data.projects?.length ?? 0} {t("مشروع")} ·{" "}
                {activeWorkspace?.data.tasks?.length ?? 0} {t("مهمة")}
              </small>
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {showWorkspaceMenu && (
            <div className="taskflow-workspace-menu" role="menu" aria-label={t("مساحات العمل")}>
              <span className="taskflow-menu-heading">{t("مساحات العمل")}</span>
              {workspaces.map((workspace) => (
                <button
                  type="button"
                  role="menuitem"
                  key={workspace.id}
                  className={`taskflow-workspace-option${workspace.id === activeWorkspace?.id ? " is-active" : ""}`}
                  onClick={() => onSwitchWorkspace(workspace)}
                >
                  <span className="taskflow-workspace-avatar">{workspace.name.trim().charAt(0) || "A"}</span>
                  <span className="taskflow-workspace-copy">
                    <strong>{workspace.name}</strong>
                    <small>
                      {workspace.data.projects?.length ?? 0} {t("مشروع")} ·{" "}
                      {workspace.data.tasks?.length ?? 0} {t("مهمة")}
                    </small>
                  </span>
                  {workspace.id === activeWorkspace?.id && <Check size={15} aria-hidden="true" />}
                </button>
              ))}
              {creatingWorkspace ? (
                <form
                  className="taskflow-create-workspace"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onCreateWorkspace();
                  }}
                >
                  <input
                    autoFocus
                    value={workspaceNameInput}
                    onChange={(event) => onWorkspaceNameChange(event.target.value)}
                    placeholder={t("اسم مساحة العمل")}
                    aria-label={t("اسم مساحة العمل")}
                    maxLength={40}
                  />
                  <button type="submit" disabled={!workspaceNameInput.trim()}                   aria-label={t("مساحة عمل جديدة")}>
                    <Check size={15} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={onCancelWorkspaceCreation} aria-label={t("إلغاء")}>
                    <X size={15} aria-hidden="true" />
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className="taskflow-create-workspace-button"
                  role="menuitem"
                  onClick={onStartWorkspaceCreation}
                >
                  <Plus size={16} aria-hidden="true" /> {t("مساحة عمل جديدة")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="taskflow-sidebar-content" data-slot="sidebar-content">
        {navGroups.map((group) => (
          <SidebarNavGroup
            key={group.label}
            {...group}
            navItems={navItems}
            page={page}
            language={language}
            onNavigate={onNavigate}
            onClose={onCloseWorkspaceMenu}
          />
        ))}
      </div>

      <div className="taskflow-sidebar-footer" data-slot="sidebar-footer">
        {canOpen3D && (
          <button type="button" className="taskflow-3d-launcher" onClick={onOpen3DLauncher}>
            <Building2 size={18} aria-hidden="true" />
            <span><strong>AI TaskFlow 3D</strong><small>{t("افتح محرر المخططات ثلاثية الأبعاد")}</small></span>
          </button>
        )}
        <div className="taskflow-sidebar-note">
          <span className="taskflow-note-icon"><Sparkles size={16} aria-hidden="true" /></span>
          <span className="taskflow-sidebar-note-copy">
            <strong>{t("مساحة أذكى، إنجاز أكبر")}</strong>
            <small>{t("اجمع مهامك ومشاريعك في مكان واحد.")}</small>
            <button type="button" onClick={() => { onNavigate("AI Providers"); onCloseWorkspaceMenu(); }}>
              {t("استكشف مركز AI")} <span aria-hidden="true">→</span>
            </button>
          </span>
        </div>
        <div className="taskflow-sidebar-footer-actions">
          <button type="button" className="taskflow-profile" onClick={onOpenProfile} title={t("تعديل الملف الشخصي")}>
            <span className="taskflow-profile-avatar">{profile.name.trim().charAt(0) || "A"}</span>
            <span className="taskflow-profile-copy">
              <strong>{profile.name || t("مساحتي الشخصية")}</strong>
              <small>{profile.email || t("المستخدم المحلي")}</small>
            </span>
            <Settings2 size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="taskflow-sidebar-footer-toggle"
            aria-label={sidebarCollapsed ? t("إظهار القائمة الجانبية") : t("إخفاء القائمة الجانبية")}
            title={sidebarCollapsed ? t("إظهار القائمة الجانبية") : t("إخفاء القائمة الجانبية")}
            aria-pressed={!sidebarCollapsed}
            onClick={onToggleSidebar}
          >
            {sidebarCollapsed
              ? <PanelLeftOpen size={17} aria-hidden="true" />
              : <PanelLeftClose size={17} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </aside>
  );
}

export default function TaskFlowDashboardLayout<TWorkspace extends DashboardWorkspace>(props: Props<TWorkspace>) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(false);
  const title = localizedPageLabel(props.page, props.language);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 780px)");
    const updateViewport = () => {
      setMobileViewport(media.matches);
      if (!media.matches) setMobileOpen(false);
    };
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  useEffect(() => {
    const toggleMobileSidebar = () => {
      if (window.matchMedia("(max-width: 780px)").matches) {
        setMobileOpen((open) => !open);
      }
    };
    window.addEventListener("taskflow:mobile-sidebar-toggle", toggleMobileSidebar);
    return () => window.removeEventListener("taskflow:mobile-sidebar-toggle", toggleMobileSidebar);
  }, []);

  const sidebarCollapsedForControl = mobileViewport ? !mobileOpen : props.sidebarCollapsed;

  return (
    <div
      className={`app-shell taskflow-dashboard${props.compactMode ? " compact-mode" : ""}${props.sidebarCollapsed ? " sidebar-collapsed" : ""}`}
      dir={props.language === "ar" ? "rtl" : "ltr"}
      data-slot="sidebar-wrapper"
      data-page={props.page}
    >
      {mobileOpen && (
        <button
          type="button"
          className="taskflow-mobile-backdrop"
          aria-label={props.language === "ar" ? "إغلاق القائمة" : "Close navigation"}
          onClick={() => setMobileOpen(false)}
        />
      )}
      <AppSidebar
        {...props}
        mobileOpen={mobileOpen}
        onOpenProfile={() => {
          props.onOpenProfile();
          setMobileOpen(false);
        }}
        onCloseWorkspaceMenu={() => {
          props.onCloseWorkspaceMenu();
          setMobileOpen(false);
        }}
      />

      <main className="taskflow-main" data-slot="sidebar-inset">
        <header className="taskflow-topbar">
          <button
            type="button"
            className="taskflow-mobile-menu"
            aria-label={props.t("القائمة")}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
          >
            <Menu size={19} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`taskflow-sidebar-toggle${sidebarCollapsedForControl ? " is-collapsed" : ""}`}
            aria-label={sidebarCollapsedForControl ? props.t("إظهار القائمة الجانبية") : props.t("إخفاء القائمة الجانبية")}
            title={sidebarCollapsedForControl ? props.t("إظهار القائمة الجانبية") : props.t("إخفاء القائمة الجانبية")}
            aria-pressed={!sidebarCollapsedForControl}
            onClick={() => {
              if (mobileViewport) setMobileOpen((open) => !open);
              else props.onToggleSidebar();
            }}
          >
            {props.sidebarCollapsed
              ? <PanelLeftOpen size={18} aria-hidden="true" />
              : <PanelLeftClose size={18} aria-hidden="true" />}
          </button>
          <div className="taskflow-breadcrumbs">
            <span>{translate("مساحة العمل", props.language)}</span>
            <span aria-hidden="true">/</span>
            <strong>{title}</strong>
          </div>
          <div className="taskflow-topbar-actions">
            <label className="taskflow-search">
              <Search size={16} aria-hidden="true" />
              <input
                value={props.search}
                onChange={(event) => props.onSearchChange(event.target.value)}
                placeholder={props.t("ابحث عن مهمة...")}
                aria-label={props.t("ابحث عن مهمة...")}
              />
            </label>
            <button
              type="button"
              className="taskflow-icon-button"
              title={props.t("المساعدة")}
              onClick={props.onOpenHelp}
              aria-label={props.t("فتح مركز المساعدة")}
            >
              <CircleHelp size={18} aria-hidden="true" />
            </button>
            <GlassAppearanceControl language={props.language} placement="toolbar" />
            <button
              type="button"
              className="taskflow-top-avatar"
              onClick={props.onOpenProfile}
              title={props.t("تعديل الملف الشخصي")}
              aria-label={props.t("تعديل الملف الشخصي")}
            >
              {props.profile.name.trim().charAt(0) || "A"}
            </button>
          </div>
        </header>

        <div className="taskflow-page-content">
          {props.children}
          <footer className="taskflow-app-footer">
            <span><i aria-hidden="true" /> {props.t("الحفظ المحلي التلقائي مفعّل")}</span>
            <span>AI TaskFlow · {props.t("الإصدار التجريبي")}</span>
          </footer>
        </div>
      </main>
      {props.overlays}
    </div>
  );
}
