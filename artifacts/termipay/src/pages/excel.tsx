import React, { useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Cell = string | number;

const initialData: Cell[][] = [
  ["Date", "Card", "Route", "Fare"],
  ["2026-10-12", "TP-0001", "Tanjay - Dumaguete", 25],
  ["2026-10-12", "TP-0002", "Tanjay - Bais", 30],
];

export default function ExcelPage() {
  const [data, setData] = useState<Cell[][]>(initialData);

  const updateCell = (r: number, c: number, value: string) => {
    setData((prev) =>
      prev.map((row, ri) =>
        ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row
      )
    );
  };

  const addRow = () =>
    setData((prev) => [...prev, new Array(prev[0]?.length || 1).fill("")]);

  const addColumn = () =>
    setData((prev) =>
      prev.map((row, i) => [...row, i === 0 ? "New Column" : ""])
    );

  const deleteRow = (r: number) =>
    setData((prev) => prev.filter((_, i) => i !== r));

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const wb = XLSX.read(await file.arrayBuffer());
    const ws = wb.Sheets[wb.SheetNames[0]];
    const imported = XLSX.utils.sheet_to_json<Cell[]>(ws, {
      header: 1,
      defval: "",
    });
    if (imported.length > 0) setData(imported);
    e.target.value = "";
  };

  const handleExport = () => {
    // Convert numeric cells to real numbers so Excel reads them correctly
    const clean = data.map((row, i) =>
      row.map((v) => (i > 0 && v !== "" && !isNaN(Number(v)) ? Number(v) : v))
    );
    const ws = XLSX.utils.aoa_to_sheet(clean);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(
      wb,
      `termipay-report-${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  };

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Excel Report Editor</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span className="mr-auto">Report</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleImport}
              className="text-sm"
            />
            <Button variant="outline" onClick={addRow}>
              + Row
            </Button>
            <Button variant="outline" onClick={addColumn}>
              + Column
            </Button>
            <Button onClick={handleExport}>Download .xlsx</Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {data.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border p-0">
                      <input
                        value={String(cell)}
                        onChange={(e) => updateCell(r, c, e.target.value)}
                        className={`w-full min-w-[120px] bg-transparent px-2 py-1.5 outline-none focus:bg-primary/10 ${
                          r === 0 ? "font-semibold bg-muted" : ""
                        }`}
                      />
                    </td>
                  ))}
                  <td className="w-10 border text-center">
                    {r > 0 && (
                      <button
                        onClick={() => deleteRow(r)}
                        className="text-red-500"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}