
import React, { useState, useEffect, useMemo } from "react";
import { useNotes, useCustomersFilter, useCurrentUser, useNoteCreate, useNoteUpdate, useNoteDelete } from "@/api/convexHooks";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Circle, Trash2, ChevronDown, AlertCircle } from "lucide-react";
import { PoolIcon, IconBadge } from "@/components/ui/iconography";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { SaltCellLogSection } from "@/components/notes/SaltCellLogSection";

const categories = ["General", "Customer", "Equipment", "Reminder", "Chemical", "Billing"];

const categoryTextClass = {
  General: "text-ink-secondary",
  Customer: "text-brand-ink",
  Equipment: "text-action",
  Reminder: "text-watch",
  Chemical: "text-info",
  Billing: "text-ok"
};

const priorityConfig = {
  low: { color: "text-ink-secondary", bg: "bg-surface-2", icon: Circle },
  medium: { color: "text-info", bg: "bg-[var(--status-info-soft)]", icon: AlertCircle },
  high: { color: "text-critical", bg: "bg-[var(--status-critical-soft)]", icon: AlertCircle }
};

export default function Notes() {
  const navigate = useNavigate();
  const user = useCurrentUser();

  const allNotes = useNotes("-created_date");
  const allCustomers = useCustomersFilter({ created_by: user.email });
  const createNote = useNoteCreate();
  const updateNote = useNoteUpdate();
  const deleteNoteMutation = useNoteDelete();

  const [notes, setNotes] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deleteNote, setDeleteNote] = useState(null);
  const [activeTab, setActiveTab] = useState("active");
  const [expandedNotes, setExpandedNotes] = useState(new Set());

  const [formData, setFormData] = useState({
    title: "",
    content: "",
    category: "General",
    customer_id: "",
    priority: "medium",
  });

  useEffect(() => {
    if (allNotes && allCustomers) {
      setNotes(allNotes);
      setCustomers(allCustomers);
      setLoading(false);
    }
  }, [allNotes, allCustomers]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const data = {
      ...formData,
      customer_id: formData.customer_id || undefined,
    };
    await createNote(data);
    setShowForm(false);
    setFormData({
      title: "",
      content: "",
      category: "General",
      customer_id: "",
      priority: "medium",
    });
    toast.success("Note created");
  };

  const handleToggleComplete = async (note) => {
    await updateNote({ id: note._id, completed: !note.completed });
    toast.success(note.completed ? "Marked as active" : "Marked as complete");
  };

  const handleDelete = async () => {
    if (deleteNote) {
      await deleteNoteMutation({ id: deleteNote._id });
      setDeleteNote(null);
      toast.success("Note deleted");
    }
  };

  const toggleNote = (noteId) => {
    const newExpanded = new Set(expandedNotes);
    if (newExpanded.has(noteId)) {
      newExpanded.delete(noteId);
    } else {
      newExpanded.add(noteId);
    }
    setExpandedNotes(newExpanded);
  };

  const getCustomerName = (customerId) => {
    return customers.find(c => c._id == customerId)?.full_name;
  };

  const filteredNotes = useMemo(() => {
    return notes.filter(note => {
      if (activeTab === "active") return !note.completed;
      if (activeTab === "completed") return note.completed;
      return true;
    });
  }, [notes, activeTab]);

  const activeCount = notes.filter(n => !n.completed).length;
  const completedCount = notes.filter(n => n.completed).length;

  if (loading) {
    return (
      <main className="relative mx-auto max-w-7xl px-3 pb-36 pt-4 font-sans sm:px-4 lg:px-6" aria-label="Notes">
        <div className="mb-4 overflow-hidden rounded-sheet border border-line bg-surface-1 p-4 shadow-card ">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.035em] text-ink">Notes &amp; Reminders</h2>
            <p className="mt-1 text-sm font-medium text-ink-muted">Loading...</p>
          </div>
        </div>
        <div className="space-y-2">
          <div className="h-20 rounded-raised border border-line bg-surface-1 shadow-card " />
          <div className="h-20 rounded-raised border border-line bg-surface-1 shadow-card " />
          <div className="h-20 rounded-raised border border-line bg-surface-1 shadow-card " />
        </div>
      </main>
    );
  }
  return (
    <main className="relative mx-auto max-w-7xl px-3 pb-36 pt-4 font-sans sm:px-4 lg:px-6" aria-label="Notes">
      <div className="mb-4 overflow-hidden rounded-sheet border border-line bg-surface-1 p-4 shadow-card ">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">Operations</p>
            <h2 className="flex items-center gap-2 text-3xl font-semibold leading-tight tracking-[-0.045em] text-ink sm:text-4xl">
              <PoolIcon name="notes" className="h-7 w-7 text-brand-ink" />
              Notes &amp; Reminders
            </h2>
            <p className="mt-1 text-sm font-medium text-ink-muted">
              {activeCount} active · {completedCount} completed
            </p>
          </div>
          <Button
            onClick={() => setShowForm(!showForm)}
            className="h-12 w-full shrink-0 rounded-full bg-brand px-6 font-semibold text-white shadow-cta hover:bg-brand-strong sm:w-auto"
          >
            <PoolIcon name="add" className="mr-2 h-4 w-4" />
            {showForm ? "Cancel" : "Add Note"}
          </Button>
        </div>
      </div>

      {showForm && (
        <Card className="mb-5 rounded-sheet border border-line bg-surface-1 p-5 shadow-card ">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-brand-softer text-brand-ink">
              <PoolIcon name="add" className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold tracking-[-0.025em] text-ink">New note</h3>
              <p className="text-sm font-medium text-ink-muted">Add a quick reminder or a detailed customer note.</p>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                required
                placeholder="Quick summary..."
                className="mt-1 rounded-2xl border border-line bg-white focus:border-ring"
              />
            </div>

            <div>
              <Label htmlFor="content">Details *</Label>
              <Textarea
                id="content"
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                required
                placeholder="Full details of the note or reminder..."
                rows={3}
                className="mt-1 rounded-2xl border border-line bg-white focus:border-ring"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="category">Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) => setFormData({ ...formData, category: value })}
                >
                  <SelectTrigger
                    aria-label="Category"
                    className="mt-1 h-11 rounded-2xl border border-line bg-white text-ink focus:border-ring"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="priority">Priority</Label>
                <Select
                  value={formData.priority}
                  onValueChange={(value) => setFormData({ ...formData, priority: value })}
                >
                  <SelectTrigger
                    aria-label="Priority"
                    className="mt-1 h-11 rounded-2xl border border-line bg-white text-ink focus:border-ring"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formData.category === "Customer" && (
              <div>
                <Label htmlFor="customer_id">Customer</Label>
                <Select
                  value={formData.customer_id ? String(formData.customer_id) : ""}
                  onValueChange={(value) => setFormData({ ...formData, customer_id: parseInt(value, 10) })}
                >
                  <SelectTrigger
                    aria-label="Customer"
                    className="mt-1 h-11 rounded-2xl border border-line bg-white text-ink focus:border-ring"
                  >
                    <SelectValue placeholder="Select customer (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map(customer => (
                      <SelectItem key={customer._id} value={String(customer._id)}>
                        {customer.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button
              type="submit"
              className="h-12 w-full rounded-full bg-brand font-semibold text-white shadow-cta hover:bg-brand-strong sm:w-auto sm:px-6"
            >
              <PoolIcon name="add" className="mr-2 h-4 w-4" />
              Save Note
            </Button>
          </form>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-5 w-full rounded-2xl border border-line bg-surface-1 p-1 shadow-card ">
          <TabsTrigger value="active" className="flex-1 rounded-xl text-ink-secondary data-[state=active]:bg-brand data-[state=active]:text-white">
            Active ({activeCount})
          </TabsTrigger>
          <TabsTrigger value="completed" className="flex-1 rounded-xl text-ink-secondary data-[state=active]:bg-brand data-[state=active]:text-white">
            Completed ({completedCount})
          </TabsTrigger>
          <TabsTrigger value="all" className="flex-1 rounded-xl text-ink-secondary data-[state=active]:bg-brand data-[state=active]:text-white">
            All ({notes.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab}>
          {filteredNotes.length === 0 ? (
            <Card className="rounded-sheet border border-line bg-surface-1 px-5 py-10 text-center shadow-card ">
              <IconBadge name="notes" size="lg" tone="slate" className="mx-auto mb-4" iconClassName="h-7 w-7" />
              <h3 className="mb-2 text-xl font-semibold tracking-[-0.035em] text-ink">
                No {activeTab === "active" ? "Active" : activeTab === "completed" ? "Completed" : ""} Notes
              </h3>
              <p className="mx-auto mb-5 max-w-sm text-sm font-medium leading-6 text-ink-secondary">
                {activeTab === "active" ? "Add a note or reminder to get started" : "No completed notes yet"}
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredNotes.map((note) => {
                const isExpanded = expandedNotes.has(note.id);
                const priority = priorityConfig[note.priority];
                const PriorityIcon = priority.icon;
                const customerName = note.customer_id ? getCustomerName(note.customer_id) : null;

                return (
                  <Card key={note.id} className="overflow-hidden rounded-raised border border-line bg-surface-1 shadow-card ">
                    <div
                      onClick={() => toggleNote(note.id)}
                      className="flex items-start justify-between gap-3 p-4 cursor-pointer transition-colors hover:bg-surface-2 active:bg-surface-2"
                    >
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleComplete(note);
                          }}
                          aria-label={note.completed ? `Mark ${note.title} as active` : `Mark ${note.title} as complete`}
                          className="mt-0.5 shrink-0 rounded-full p-1 transition-colors hover:bg-brand-softer"
                        >
                          {note.completed ? (
                            <CheckCircle2 className="h-5 w-5 text-ok" aria-hidden="true" />
                          ) : (
                            <Circle className="h-5 w-5 text-ink-muted" aria-hidden="true" />
                          )}
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className={`font-semibold text-ink ${note.completed ? 'line-through text-ink-muted' : ''}`}>
                              {note.title}
                            </h3>
                            <span className={`rounded-full border border-[var(--status-info-line)] bg-brand-softer px-2 py-0.5 text-xs font-medium ${categoryTextClass[note.category]}`}>
                              {note.category}
                            </span>
                            <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${priority.bg}`}>
                              <PriorityIcon className={`h-3 w-3 ${priority.color}`} aria-hidden="true" />
                              <span className={priority.color}>{note.priority}</span>
                            </div>
                          </div>

                          {customerName && (
                            <div className="flex items-center gap-2 flex-wrap text-xs text-ink-secondary">
                              <span className="text-brand-ink">→ {customerName}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteNote(note);
                            }}
                            aria-label={`Delete ${note.title}`}
                            className="h-8 w-8 text-critical hover:bg-[var(--status-critical-soft)] hover:text-critical"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <ChevronDown className={`h-5 w-5 text-ink-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-line bg-surface-2 p-4">
                        <p className="text-sm leading-relaxed text-ink-secondary whitespace-pre-wrap">
                          {note.content}
                        </p>
                        <div className="mt-3 border-t border-line pt-3 text-xs text-ink-muted">
                          Created {format(parseISO(note.created_date), "MMM dd, yyyy 'at' h:mm a")}
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!deleteNote} onOpenChange={() => setDeleteNote(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Note?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteNote?.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SaltCellLogSection customers={customers} />
    </main>
  );
}
