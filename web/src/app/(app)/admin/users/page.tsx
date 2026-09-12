'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Plus, Search, ShieldCheck, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import type { CapabilityDef, ManagedUser, Paged, Programme, Role } from '@/lib/types';

const ROLES: Role[] = ['ADMIN', 'MODULE_LEADER', 'LECTURER', 'STUDENT'];
const ROLE_LABEL: Record<Role, string> = { ADMIN: 'RTE Admin', MODULE_LEADER: 'Module leader', LECTURER: 'Lecturer', STUDENT: 'Student' };
const ROLE_STYLE: Record<Role, string> = {
  ADMIN: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  MODULE_LEADER: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  LECTURER: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200',
  STUDENT: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};

export default function UsersPage() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);

  const query = qs({ q, role, page, pageSize: 20 });
  const users = useQuery({ queryKey: ['admin', 'users', query], queryFn: () => api<Paged<ManagedUser>>(`/api/admin/users${query}`), placeholderData: keepPreviousData });
  const catalogue = useQuery({ queryKey: ['admin', 'actions'], queryFn: () => api<{ actions: CapabilityDef[]; groups: string[] }>('/api/admin/actions') });
  const programmes = useQuery({ queryKey: ['programmes'], queryFn: () => api<Programme[]>('/api/programmes'), enabled: open });

  const [form, setForm] = useState({ email: '', name: '', role: 'LECTURER' as Role, password: '', studentId: '', programmeId: '', intakeId: '', sectionId: '' });
  const intakes = programmes.data?.find((p) => p.id === form.programmeId)?.intakes ?? [];
  const sections = useQuery({
    queryKey: ['sections', form.intakeId],
    queryFn: () => api<{ id: string; name: string }[]>(`/api/timetable/sections?intakeId=${form.intakeId}`),
    enabled: open && form.role === 'STUDENT' && !!form.intakeId,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin'] });

  const create = useMutation({
    mutationFn: () =>
      api<ManagedUser>('/api/admin/users', {
        method: 'POST',
        body: {
          email: form.email,
          name: form.name,
          role: form.role,
          password: form.password || undefined,
          student: form.role === 'STUDENT' ? { studentId: form.studentId, programmeId: form.programmeId, intakeId: form.intakeId, sectionId: form.sectionId || undefined } : undefined,
        },
      }),
    onSuccess: (u) => {
      toast.success(u.temporaryPassword ? `${u.name} created — temporary password ${u.temporaryPassword}` : `${u.name} created`, { duration: 10000 });
      setOpen(false);
      setForm({ email: '', name: '', role: 'LECTURER', password: '', studentId: '', programmeId: '', intakeId: '', sectionId: '' });
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create the account'),
  });

  const toggle = useMutation({
    mutationFn: ({ id, action, allowed }: { id: string; action: string; allowed: boolean }) => api<ManagedUser>(`/api/admin/users/${id}/permissions`, { method: 'POST', body: { action, allowed } }),
    onSuccess: (u) => {
      setEditing(u);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not change the permission'),
  });

  const update = useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: Record<string, unknown> }) => api<ManagedUser>(`/api/admin/users/${id}`, { method: 'PATCH', body: fields }),
    onSuccess: (u) => {
      toast.success(`${u.name} updated`);
      setEditing(u);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Update failed'),
  });

  const resetPassword = useMutation({
    mutationFn: (id: string) => api<{ email: string; temporaryPassword: string }>(`/api/admin/users/${id}/reset-password`, { method: 'POST', body: {} }),
    onSuccess: (r) => toast.success(`New password for ${r.email}: ${r.temporaryPassword}`, { duration: 15000 }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Reset failed'),
  });

  const grouped = useMemo(() => {
    const g = new Map<string, CapabilityDef[]>();
    for (const a of catalogue.data?.actions ?? []) g.set(a.group, [...(g.get(a.group) ?? []), a]);
    return [...g.entries()];
  }, [catalogue.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users & permissions</h1>
          <p className="text-sm text-muted-foreground">Add students, lecturers, module leaders and administrators. Every capability can be switched on or off for one person without changing their role.</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" /> New user</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="w-64 pl-8" placeholder="Search name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <Select value={role} onValueChange={(v) => { setRole(v ?? 'all'); setPage(1); }} items={{ all: 'All roles', ...Object.fromEntries(ROLES.map((r) => [r, ROLE_LABEL[r]])) }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All roles</SelectItem>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {users.isError && <Alert variant="destructive"><AlertDescription>{(users.error as Error).message}</AlertDescription></Alert>}

      <div className="overflow-x-auto border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Attached to</TableHead><TableHead className="text-right">Capabilities</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {users.isPending && Array.from({ length: 6 }).map((_, i) => <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>)}
            {users.data?.items.map((u) => {
              const custom = u.overrides.grant.length + u.overrides.revoke.length;
              return (
                <TableRow key={u.id} className={cn(!u.isActive && 'opacity-60')}>
                  <TableCell><div className="font-medium">{u.name}</div><div className="text-xs text-muted-foreground">{u.email}</div></TableCell>
                  <TableCell><Badge variant="outline" className={cn('border-transparent', ROLE_STYLE[u.role])}>{ROLE_LABEL[u.role]}</Badge></TableCell>
                  <TableCell className="text-xs">
                    {u.student ? `${u.student.studentId} · ${u.student.intake.programme.code} ${u.student.intake.label}${u.student.section ? ` · section ${u.student.section.name}` : ''}` : null}
                    {!u.student && (u.workload.classes || u.workload.offerings || u.workload.modulesLed) ? `${u.workload.offerings} module(s), ${u.workload.classes} weekly classes${u.workload.modulesLed ? `, leads ${u.workload.modulesLed}` : ''}` : null}
                    {!u.student && !u.workload.classes && !u.workload.offerings && !u.workload.modulesLed ? <span className="text-muted-foreground">—</span> : null}
                  </TableCell>
                  <TableCell className="text-right">{u.actions.length}{custom > 0 && <Badge variant="outline" className="ml-2 border-brand-orange text-brand-orange">{custom} custom</Badge>}</TableCell>
                  <TableCell>{u.isActive ? <span className="text-emerald-600 dark:text-emerald-400">Active</span> : <span className="text-muted-foreground">Deactivated</span>}</TableCell>
                  <TableCell className="text-right">
                    <Button size="xs" variant="outline" onClick={() => setEditing(u)}><ShieldCheck className="mr-1 h-3.5 w-3.5" /> Permissions</Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {users.data && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{users.data.total} accounts · page {users.data.page} of {users.data.pages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= users.data.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* ---------- create ---------- */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New user</DialogTitle><DialogDescription>The role sets the starting capabilities; you can fine-tune them afterwards. Leave the password empty to generate a temporary one.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Full name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1"><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@islingtoncollege.edu.np" /></div>
            <div className="space-y-1"><Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: (v ?? 'LECTURER') as Role })} items={Object.fromEntries(ROLES.map((r) => [r, ROLE_LABEL[r]]))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Password (optional)</Label><Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="auto-generated" /></div>
            {form.role === 'STUDENT' && (
              <>
                <div className="space-y-1"><Label>Student ID</Label><Input value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} placeholder="26010123" /></div>
                <div className="space-y-1"><Label>Programme</Label>
                  <Select value={form.programmeId} onValueChange={(v) => setForm({ ...form, programmeId: v ?? '', intakeId: '', sectionId: '' })} items={Object.fromEntries((programmes.data ?? []).map((p) => [p.id, p.code]))}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Programme" /></SelectTrigger>
                    <SelectContent>{programmes.data?.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} · {p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>Intake</Label>
                  <Select value={form.intakeId} onValueChange={(v) => setForm({ ...form, intakeId: v ?? '', sectionId: '' })} items={Object.fromEntries(intakes.map((i) => [i.id, i.label]))} disabled={!form.programmeId}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Intake" /></SelectTrigger>
                    <SelectContent>{intakes.map((i) => <SelectItem key={i.id} value={i.id}>{i.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>Section (optional)</Label>
                  <Select value={form.sectionId} onValueChange={(v) => setForm({ ...form, sectionId: v ?? '' })} items={Object.fromEntries((sections.data ?? []).map((s) => [s.id, `Section ${s.name}`]))} disabled={!form.intakeId}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Section" /></SelectTrigger>
                    <SelectContent>{sections.data?.map((s) => <SelectItem key={s.id} value={s.id}>Section {s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={create.isPending || !form.name || !form.email || (form.role === 'STUDENT' && (!form.studentId || !form.programmeId || !form.intakeId))} onClick={() => create.mutate()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- permissions ---------- */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.name}</DialogTitle>
            <DialogDescription>
              {editing ? `${editing.email} · ${ROLE_LABEL[editing.role]}` : ''}. Switches follow the role by default; a change is stored as a personal exception and takes effect within a few seconds.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-xs">Role</Label>
                <Select value={editing.role} onValueChange={(v) => v && v !== editing.role && update.mutate({ id: editing.id, fields: { role: v } })} items={Object.fromEntries(ROLES.map((r) => [r, ROLE_LABEL[r]]))} disabled={editing.id === me?.id}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="xs" variant="outline" onClick={() => resetPassword.mutate(editing.id)}><KeyRound className="mr-1 h-3.5 w-3.5" /> Reset password</Button>
                {editing.id !== me?.id && (
                  <Button size="xs" variant={editing.isActive ? 'destructive' : 'outline'} onClick={() => update.mutate({ id: editing.id, fields: { isActive: !editing.isActive } })}>
                    <UserX className="mr-1 h-3.5 w-3.5" /> {editing.isActive ? 'Deactivate' : 'Reactivate'}
                  </Button>
                )}
              </div>
              {grouped.map(([group, actions]) => (
                <div key={group}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</div>
                  <div className="space-y-1">
                    {actions.map((a) => {
                      const on = editing.actions.includes(a.key);
                      const isDefault = a.roles.includes(editing.role);
                      return (
                        <label key={a.key} className="flex items-start gap-2 border p-2 text-sm">
                          <Checkbox
                            checked={on}
                            disabled={toggle.isPending}
                            onCheckedChange={(c) => toggle.mutate({ id: editing.id, action: a.key, allowed: !!c })}
                          />
                          <span className="flex-1">
                            {a.label}
                            <span className="ml-2 font-mono text-[10px] text-muted-foreground">{a.key}</span>
                            {on !== isDefault && <Badge variant="outline" className="ml-2 border-brand-orange text-[10px] text-brand-orange">{on ? 'granted' : 'removed'}</Badge>}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
