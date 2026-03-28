"use client";

import { BellIcon } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";

const Notifications = () => {
  const isMobile = useIsMobile();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" className="relative">
          <BellIcon />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align={isMobile ? "center" : "end"} className="ms-4 w-80 p-0">
        <DropdownMenuLabel className="bg-background dark:bg-muted sticky top-0 z-10 p-0">
          <div className="flex justify-between border-b px-6 py-4">
            <div className="font-medium">Notifications</div>
          </div>
        </DropdownMenuLabel>

        <div className="p-4">
          <Empty className="gap-3">
            <div className="space-y-2">
              <div className="font-medium">No notifications yet</div>
              <p className="text-muted-foreground text-sm">
                Alerts from guards, terminals, and sites will appear here once they are connected.
              </p>
            </div>
          </Empty>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default Notifications;
