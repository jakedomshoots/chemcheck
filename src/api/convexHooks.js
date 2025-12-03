import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useUser } from "@clerk/clerk-react";

/**
 * Convex entity hooks - replacement for Base44 SDK
 * These hooks provide the same API surface as Base44 entities
 */

// Customer hooks
export function useCustomers() {
    return useQuery(api.customers.list) || [];
}

export function useCustomersFilter(filters) {
    return useQuery(api.customers.filter, filters) || [];
}

export function useCustomer(id) {
    return useQuery(api.customers.get, { id });
}

export function useCustomerCreate() {
    return useMutation(api.customers.create);
}

export function useCustomerUpdate() {
    return useMutation(api.customers.update);
}

export function useCustomerDelete() {
    return useMutation(api.customers.remove);
}

// ServiceLog hooks
export function useServiceLogs(order = "-service_date", limit = 100) {
    return useQuery(api.serviceLogs.list, { order, limit }) || [];
}

export function useServiceLogsFilter(filters) {
    return useQuery(api.serviceLogs.filter, filters) || [];
}

export function useServiceLogsByCustomer(customerId) {
    return useQuery(api.serviceLogs.getByCustomer, { customer_id: customerId }) || [];
}

export function useServiceLogCreate() {
    return useMutation(api.serviceLogs.create);
}

export function useServiceLogUpdate() {
    return useMutation(api.serviceLogs.update);
}

export function useServiceLogDelete() {
    return useMutation(api.serviceLogs.remove);
}

// ChemicalUsage hooks
export function useChemicalUsage(order = "-created_date", limit = 100) {
    return useQuery(api.chemicalUsage.list, { order, limit }) || [];
}

export function useChemicalUsageFilter(filters) {
    return useQuery(api.chemicalUsage.filter, filters) || [];
}

export function useChemicalUsageCreate() {
    return useMutation(api.chemicalUsage.create);
}

export function useChemicalUsageUpdate() {
    return useMutation(api.chemicalUsage.update);
}

export function useChemicalUsageDelete() {
    return useMutation(api.chemicalUsage.remove);
}

// Note hooks
export function useNotes(order = "-created_date") {
    return useQuery(api.notes.list, { order }) || [];
}

export function useNotesFilter(filters) {
    return useQuery(api.notes.filter, filters) || [];
}

export function useNoteCreate() {
    return useMutation(api.notes.create);
}

export function useNoteUpdate() {
    return useMutation(api.notes.update);
}

export function useNoteDelete() {
    return useMutation(api.notes.remove);
}

// User/Auth hook - now using Clerk
export function useCurrentUser() {
    const { user } = useUser();

    if (!user) {
        return {
            email: "",
            name: "Guest"
        };
    }

    return {
        email: user.primaryEmailAddress?.emailAddress || "",
        name: user.fullName || user.firstName || "User"
    };
}
