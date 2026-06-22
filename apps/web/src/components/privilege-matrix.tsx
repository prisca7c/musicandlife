'use client';

import { useState } from 'react';
import { PRIVILEGE_LABELS, DEFAULT_TEACHER_PRIVILEGES } from '@music-life/types';
import type { StaffPrivileges } from '@music-life/types';
import { apiFetch } from '@/lib/api';

interface Props {
  staffId: string;
  privileges: Record<string, boolean>;
}

export function PrivilegeMatrix({ staffId, privileges: initial }: Props) {
  const [privs, setPrivs] = useState<Record<string, boolean>>(
    Object.keys(PRIVILEGE_LABELS).reduce<Record<string, boolean>>((acc, key) => {
      acc[key] = initial[key] ?? DEFAULT_TEACHER_PRIVILEGES[key as keyof StaffPrivileges] ?? false;
      return acc;
    }, {}),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggle(key: string) {
    setPrivs((p) => ({ ...p, [key]: !p[key] }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      const token = document.cookie.match(/access_token=([^;]+)/)?.[1];
      await apiFetch(`/staff/${staffId}/privileges`, {
        method: 'PATCH',
        body: JSON.stringify({ privileges: privs }),
        token,
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const groups = [
    { label: 'Administration', keys: ['administrator'] },
    { label: 'Self-management', keys: ['lessons.edit_own', 'payroll.view_own', 'payments.record', 'mileage.manage'] },
    { label: 'Other teachers', keys: ['teachers.view_contact', 'teachers.view_lessons', 'teachers.manage_students_lessons'] },
    { label: 'Students & families', keys: ['family.view_address_phone', 'family.view_email', 'attachments.view_download'] },
    { label: 'Finance & ops', keys: ['invoices.manage', 'expenses.manage', 'resources.manage', 'reports.manage', 'website.edit'] },
  ];

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h2 className="font-semibold text-gray-700">Privileges</h2>
        <button
          onClick={save}
          disabled={saving}
          className="text-sm bg-indigo-600 text-white rounded px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
      <div className="divide-y">
        {groups.map((group) => (
          <div key={group.label} className="px-4 py-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{group.label}</p>
            <div className="space-y-2">
              {group.keys.map((key) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!privs[key]}
                    onChange={() => toggle(key)}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-gray-700">
                    {PRIVILEGE_LABELS[key as keyof StaffPrivileges]}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
