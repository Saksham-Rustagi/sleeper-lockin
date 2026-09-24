"use client";

import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { parseJSON } from "@/lib/parser";

export default function ExportImport() {
  const weekData = useStore((state) => state.weekData);
  const setWeekData = useStore((state) => state.setWeekData);

  const handleExport = () => {
    if (!weekData) {
      toast.error("No data to export");
      return;
    }

    const dataStr = JSON.stringify(weekData, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.href = url;
    link.download = `sleeper-week-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast.success("Week data exported!");
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const data = await parseJSON(file);
      setWeekData(data);
      toast.success("Week data imported!");
    } catch (error: any) {
      toast.error(error.message || "Failed to import data");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export / Import Week Data</CardTitle>
        <CardDescription>
          Save your week setup to a file or load a previously saved week
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3">
          <Button
            onClick={handleExport}
            disabled={!weekData}
            className="flex-1"
          >
            <Download className="w-4 h-4 mr-2" />
            Export to File
          </Button>

          <div className="flex-1">
            <Label htmlFor="import-file">
              <Button
                asChild
                variant="outline"
                className="w-full cursor-pointer"
              >
                <span>
                  <Upload className="w-4 h-4 mr-2" />
                  Import from File
                </span>
              </Button>
            </Label>
            <Input
              id="import-file"
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
          </div>
        </div>

        <div className="text-xs text-gray-500 bg-gray-50 dark:bg-gray-800 p-3 rounded">
          <strong>Note:</strong> Your data is automatically saved in your browser. 
          Export to file as a backup or to transfer between devices.
        </div>
      </CardContent>
    </Card>
  );
}

