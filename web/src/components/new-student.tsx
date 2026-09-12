'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';

interface Programme { id: string; code: string; name: string }
interface Intake { id: string; label: string; programmeId: string }
interface Defaults {
  studentId: string;
  suggestedSectionId: string | null;
  sections: { id: string; name: string; students: number }[];
  currentSemester: { id: string; number: number; term: string } | null;
}

/**
 * Enrol a new student.
 *
 * A record with no group and no modules is a name in a list, so the whole placement happens in
 * one form: the institutional ID and the emptiest group are filled in by the server rather than
 * typed, which is how two students stop sharing an ID and how a room of twenty stops holding
 * twenty-six.
 */
export function NewStudent() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [programmeId, setProgrammeId] = useState('');
  const [intakeId, setIntakeId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [createLogin, setCreateLogin] = useState(true);
  const [specialNeedsSeating, setSpecialNeeds] = useState(false);

  const programmes = useQuery({ queryKey: ['programmes'], queryFn: () => api<Programme[]>('/api/programmes'), enabled: open });
  const intakes = useQuery({
    queryKey: ['intakes', programmeId],
    queryFn: () => api<Intake[]>(`/api/intakes?programmeId=${programmeId}`),
    enabled: open && !!programmeId,
  });
  const defaults = useQuery({
    queryKey: ['enrolment-defaults', programmeId, intakeId],
    queryFn: () => api<Defaults>(`/api/students/enrolment-defaults?programmeId=${programmeId}&intakeId=${intakeId}`),
    enabled: open && !!programmeId && !!intakeId,
  });

  // The server's suggestions fill the two fields until somebody types over them. Derived rather
  // than copied into state on arrival, so choosing a different intake re-suggests instead of
  // leaving the previous intake's ID sitting in the box.
  const effectiveStudentId = studentId || defaults.data?.studentId || '';
  const effectiveSectionId = sectionId || defaults.data?.suggestedSectionId || '';

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string; enrolledModules?: number }>('/api/students', {
        method: 'POST',
        body: {
          studentId: effectiveStudentId.trim(),
          name: name.trim(),
          email: email.trim() || undefined,
          programmeId,
          intakeId,
          sectionId: effectiveSectionId || undefined,
          specialNeedsSeating,
          createLogin: createLogin && !!email.trim(),
          autoEnroll: true,
        },
      }),
    onSuccess: (r) => {
      toast.success('Student enrolled', {
        description: r.enrolledModules ? `Placed in a group and enrolled on ${r.enrolledModules} modules.` : 'Placed in a group.',
      });
      setOpen(false);
      setStudentId('');
      setName('');
      setEmail('');
      setSectionId('');
      void qc.invalidateQueries({ queryKey: ['students'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ready = programmeId && intakeId && effectiveStudentId.trim().length >= 3 && name.trim().length >= 2;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><UserPlus className="mr-1 h-4 w-4" /> New student</Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Enrol a student</DialogTitle>
            <DialogDescription>
              They are given the next institutional ID, placed in the group with the most room, and enrolled on this semester&apos;s modules.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1">
                <Label>Programme</Label>
                <Select value={programmeId} onValueChange={(v) => { setProgrammeId(v ?? ''); setIntakeId(''); setStudentId(''); setSectionId(''); }}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>{(programmes.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.code}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-1">
                <Label>Intake</Label>
                <Select value={intakeId} onValueChange={(v) => { setIntakeId(v ?? ''); setStudentId(''); setSectionId(''); }}>
                  <SelectTrigger className="w-full"><SelectValue placeholder={programmeId ? 'Choose' : 'Programme first'} /></SelectTrigger>
                  <SelectContent>{(intakes.data ?? []).map((i) => <SelectItem key={i.id} value={i.id}>{i.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1">
                <Label htmlFor="ns-id">Student ID</Label>
                <Input id="ns-id" value={effectiveStudentId} onChange={(e) => setStudentId(e.target.value)} placeholder={defaults.isFetching ? 'Working it out…' : '—'} />
              </div>
              <div className="min-w-0 space-y-1">
                <Label>Group</Label>
                <Select value={effectiveSectionId} onValueChange={(v) => setSectionId(v ?? '')}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Emptiest group" /></SelectTrigger>
                  <SelectContent>
                    {(defaults.data?.sections ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name} — {s.students} students</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="ns-name">Full name</Label>
              <Input id="ns-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="As it should appear on results" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ns-email">Email</Label>
              <Input id="ns-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@student.islington.edu.np" />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={createLogin} onCheckedChange={(v) => setCreateLogin(!!v)} disabled={!email.trim()} />
              Create a login for them {email.trim() ? '' : '(needs an email)'}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={specialNeedsSeating} onCheckedChange={(v) => setSpecialNeeds(!!v)} />
              Needs particular seating in exams
            </label>

            {defaults.data && !defaults.data.currentSemester && (
              <Alert className="rounded-none">
                <AlertDescription>That intake has no semester yet, so there are no modules to enrol them on. They will be placed in a group only.</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!ready || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Enrolling…' : 'Enrol'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
