"use client";

import React, { useEffect, useState } from "react";

interface UploadFile { name: string; url: string; mtime: number; }

export default function UploadsApp() {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState("");

  const load = async () => {
    try {
      const res = await fetch("/my/api/upload-list");
      const data = await res.json();
      if (data?.success && Array.isArray(data.files)) setFiles(data.files);
    } catch (e) {
      setStatus(String(e));
    }
  };

  useEffect(() => { load(); }, []);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setStatus("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/my/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || "upload failed");
      await load();
      setStatus("Uploaded");
    } catch (err) {
      setStatus(String(err));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold font-display">Uploads</h1>
      <div className="mt-4">
        <input type="file" accept="image/*" onChange={onUpload} disabled={uploading} />
        {uploading && <span className="ml-2 text-text-muted">Uploading…</span>}
      </div>
      {status && <p className="mt-2 text-text-muted">{status}</p>}
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {files.map((f) => (
          <div key={f.name} className="border border-border rounded-sm overflow-hidden">
            <img src={f.url} alt={f.name} className="w-full h-40 object-cover" />
            <p className="text-xs text-text-muted p-1 truncate">{f.name}</p>
          </div>
        ))}
      </div>
      {files.length === 0 && <p className="mt-6 text-text-muted">No uploads yet.</p>}
    </div>
  );
}
