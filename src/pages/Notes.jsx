
import React, { useState, useEffect, useMemo } from "react";
import { useNotes, useCustomersFilter, useCurrentUser, useNoteCreate, useNoteUpdate, useNoteDelete } from "@/api/convexHooks";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Plus, StickyNote, CheckCircle2, Circle, Trash2, ChevronDown, AlertCircle, Clock } from "lucide-react";
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

const categories = ["General", "Customer", "Equipment", "Reminder", "Chemical", "Billing"];

const categoryColors = {
  General: "from-slate-500 to-gray-600",
  Customer: "from-cyan-500 to-blue-600",
  Equipment: "from-orange-500 to-red-600",
  Reminder: "from-yellow-500 to-amber-600",
  Chemical: "from-purple-500 to-pink-600",
  Billing: "from-green-500 to-emerald-600"
};

const priorityConfig = {
  low: { color: "text-slate-600", bg: "bg-slate-100", icon: Circle },
  medium: { color: "text-blue-600", bg: "bg-blue-100", icon: AlertCircle },
  high: { color: "text-red-600", bg: "bg-red-100", icon: AlertCircle }
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
    return customers.find(c => c._id === customerId)?.full_name;
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl shadow-lg">
            <StickyNote className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Notes & Reminders</h2>
            <p className="text-sm text-slate-600">{activeCount} active • {completedCount} completed</p>
          </div>
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          className="w-full sm:w-auto bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white shadow-lg"
        >
          <Plus className="w-5 h-5 mr-2" />
          {showForm ? "Cancel" : "Add Note"}
        </Button>
      </div>

      {/* Quick Add Form */}
      {showForm && (
        <Card className="p-6 mb-6 border-2 shadow-lg bg-gradient-to-br from-amber-50 to-orange-50">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                required
                placeholder="Quick summary..."
                className="mt-1 border-2 focus:border-amber-500 rounded-xl"
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
                className="mt-1 border-2 focus:border-amber-500 rounded-xl"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="category">Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) => setFormData({ ...formData, category: value })}
                >
                  <SelectTrigger className="mt-1 border-2 focus:border-amber-500 rounded-xl">
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
                  <SelectTrigger className="mt-1 border-2 focus:border-amber-500 rounded-xl">
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
                  value={formData.customer_id}
                  onValueChange={(value) => setFormData({ ...formData, customer_id: value })}
                >
                  <SelectTrigger className="mt-1 border-2 focus:border-amber-500 rounded-xl">
                    <SelectValue placeholder="Select customer (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map(customer => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white"
            >
              Save Note
            </Button>
          </form>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full bg-slate-100 p-1 rounded-2xl mb-6">
          <TabsTrigger value="active" className="flex-1 rounded-xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-amber-500 data-[state=active]:to-orange-600 data-[state=active]:text-white">
            Active ({activeCount})
          </TabsTrigger>
          <TabsTrigger value="completed" className="flex-1 rounded-xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-emerald-500 data-[state=active]:to-green-600 data-[state=active]:text-white">
            Completed ({completedCount})
          </TabsTrigger>
          <TabsTrigger value="all" className="flex-1 rounded-xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-slate-500 data-[state=active]:to-gray-600 data-[state=active]:text-white">
            All ({notes.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab}>
          {filteredNotes.length === 0 ? (
            <Card className="p-12 text-center bg-slate-50 border-2 border-dashed border-slate-200">
              <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 rounded-full flex items-center justify-center">
                <StickyNote className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                No {activeTab === "active" ? "Active" : activeTab === "completed" ? "Completed" : ""} Notes
              </h3>
              <p className="text-slate-600 mb-4">
                {activeTab === "active" ? "Add a note or reminder to get started" : "No completed notes yet"}
              </p>
              {activeTab === "active" && (
                <Button
                  onClick={() => setShowForm(true)}
                  className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Note
                </Button>
              )}
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredNotes.map((note) => {
                const isExpanded = expandedNotes.has(note.id);
                const priority = priorityConfig[note.priority];
                const PriorityIcon = priority.icon;
                const customerName = note.customer_id ? getCustomerName(note.customer_id) : null;

                return (
                  <Card key={note.id} className="overflow-hidden border-2 shadow-sm">
                    <div
                      onClick={() => toggleNote(note.id)}
                      className="flex items-start justify-between p-4 cursor-pointer hover:bg-slate-50 active:bg-slate-100"
                    >
                      <div className="flex items-start gap-3 flex-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleComplete(note);
                          }}
                          className="mt-0.5"
                        >
                          {note.completed ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                          ) : (
                            <Circle className="w-5 h-5 text-slate-400 hover:text-amber-600" />
                          )}
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className={`font-semibold text-slate-900 ${note.completed ? 'line-through text-slate-500' : ''}`}>
                              {note.title}
                            </h3>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium bg-gradient-to-r ${categoryColors[note.category]} text-white`}>
                              {note.category}
                            </span>
                            <div className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${priority.bg}`}>
                              <PriorityIcon className={`w-3 h-3 ${priority.color}`} />
                              <span className={priority.color}>{note.priority}</span>
                            </div>
                          </div>

                          {customerName && (
                            <div className="flex items-center gap-2 flex-wrap text-xs text-slate-600">
                              <span className="text-cyan-600">→ {customerName}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteNote(note);
                            }}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 w-8"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                          <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-slate-200 bg-slate-50 p-4">
                        <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                          {note.content}
                        </p>
                        <div className="mt-3 pt-3 border-t border-slate-200 text-xs text-slate-500">
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
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
