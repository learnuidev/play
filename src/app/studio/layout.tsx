import { AppSidebar } from '@/components/studio/app-sidebar';
import { SidebarInset, SidebarProvider, SidebarRail } from '@/components/ui/sidebar';

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>{children}</SidebarInset>
      <SidebarRail />
    </SidebarProvider>
  );
}
