'use client';

import { PageHeader } from '@/components/page-header';

export default function ContentPage() {
  return (
    <div>
      <PageHeader title="Content" subtitle="Assign and track pieces for your students" />
      <div className="bg-white rounded-xl border px-5 py-12 text-center">
        <p className="text-gray-500 font-medium mb-2">Repertoire management</p>
        <p className="text-sm text-gray-400 max-w-sm mx-auto">
          The repertoire module is scaffolded in the database (repertoire_pieces table).
          The full CRUD UI is the next sprint iteration. For now, piece assignments can be created via the API directly.
        </p>
        <p className="text-xs text-gray-300 mt-4">POST /repertoire-pieces · GET /students/:id/repertoire</p>
      </div>
    </div>
  );
}
