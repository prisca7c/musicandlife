'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { AssignStudentsModal } from '@/components/assign-students-modal';

/**
 * Small client button for the staff detail page — opens the AssignStudentsModal
 * locked to a single teacher, and refreshes the server component on change so the
 * "Assigned Students" table updates.
 */
export function AssignStudentsButton({ teacherId, teacherName }: { teacherId: string; teacherName: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [first = '', ...rest] = teacherName.split(' ');
  const teacher = { id: teacherId, firstName: first, lastName: rest.join(' ') };

  return (
    <>
      <button onClick={() => setOpen(true)} className="ui-btn-ghost text-sm">
        <UserPlus size={14} /> Assign students
      </button>
      <AssignStudentsModal
        open={open}
        onClose={() => setOpen(false)}
        teachers={[teacher]}
        defaultTeacherId={teacherId}
        onChanged={() => router.refresh()}
      />
    </>
  );
}
