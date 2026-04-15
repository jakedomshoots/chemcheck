import { mutation } from "./_generated/server";

/**
 * Permanently deletes all data owned by the authenticated user.
 * This is intended for account deletion flows (App Store compliance).
 */
export const deleteMyAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || !identity.email) {
      throw new Error("Not authenticated");
    }

    const userEmail = identity.email;
    const warnings: string[] = [];

    const summary = {
      customers: 0,
      serviceLogs: 0,
      chemicalUsage: 0,
      notes: 0,
      saltCellLogs: 0,
      servicePhotos: 0,
      serviceReports: 0,
      reportAccessLogs: 0,
      subscriptions: 0,
      businesses: 0,
      teamMembers: 0,
      storageFiles: 0,
      rateLimits: 0,
      rateLimitViolations: 0,
    };

    const deletedNoteIds = new Set<string>();
    const deletedPhotoIds = new Set<string>();
    const deletedTeamMemberIds = new Set<string>();
    const deletedReportIds = new Set<string>();
    const deletedReportAccessLogIds = new Set<string>();

    // 1) Delete customer-owned data trees.
    const customers = await ctx.db
      .query("customers")
      .withIndex("by_created_by", (q) => q.eq("created_by", userEmail))
      .collect();

    for (const customer of customers) {
      const customerId = customer._id;

      const serviceLogs = await ctx.db
        .query("serviceLogs")
        .withIndex("by_customer", (q) => q.eq("customer_id", customerId))
        .collect();

      for (const serviceLog of serviceLogs) {
        const serviceLogId = serviceLog._id;

        const servicePhotos = await ctx.db
          .query("servicePhotos")
          .withIndex("by_service_log", (q) => q.eq("service_log_id", serviceLogId))
          .collect();

        for (const photo of servicePhotos) {
          const photoId = String(photo._id);
          if (deletedPhotoIds.has(photoId)) continue;

          await ctx.db.delete(photo._id);
          deletedPhotoIds.add(photoId);
          summary.servicePhotos += 1;

          try {
            await ctx.storage.delete(photo.storage_id);
            summary.storageFiles += 1;
          } catch (error) {
            warnings.push(
              `Failed to delete storage object for photo ${photoId}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }

        const reports = await ctx.db
          .query("serviceReports")
          .withIndex("by_service_log", (q) => q.eq("service_log_id", serviceLogId))
          .collect();

        for (const report of reports) {
          const reportId = String(report._id);
          if (deletedReportIds.has(reportId)) continue;

          const accessLogs = await ctx.db
            .query("reportAccessLogs")
            .withIndex("by_token", (q) => q.eq("report_token", report.report_token))
            .collect();

          for (const accessLog of accessLogs) {
            const accessLogId = String(accessLog._id);
            if (deletedReportAccessLogIds.has(accessLogId)) continue;
            await ctx.db.delete(accessLog._id);
            deletedReportAccessLogIds.add(accessLogId);
            summary.reportAccessLogs += 1;
          }

          await ctx.db.delete(report._id);
          deletedReportIds.add(reportId);
          summary.serviceReports += 1;
        }

        await ctx.db.delete(serviceLogId);
        summary.serviceLogs += 1;
      }

      // Catch orphan photos that still reference this customer.
      const orphanCustomerPhotos = await ctx.db
        .query("servicePhotos")
        .withIndex("by_customer", (q) => q.eq("customer_id", customerId))
        .collect();

      for (const photo of orphanCustomerPhotos) {
        const photoId = String(photo._id);
        if (deletedPhotoIds.has(photoId)) continue;

        await ctx.db.delete(photo._id);
        deletedPhotoIds.add(photoId);
        summary.servicePhotos += 1;

        try {
          await ctx.storage.delete(photo.storage_id);
          summary.storageFiles += 1;
        } catch (error) {
          warnings.push(
            `Failed to delete storage object for orphan photo ${photoId}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      const chemicalUsage = await ctx.db
        .query("chemicalUsage")
        .withIndex("by_customer", (q) => q.eq("customer_id", customerId))
        .collect();

      for (const chemicalRecord of chemicalUsage) {
        await ctx.db.delete(chemicalRecord._id);
        summary.chemicalUsage += 1;
      }

      const notes = await ctx.db
        .query("notes")
        .withIndex("by_customer", (q) => q.eq("customer_id", customerId))
        .collect();

      for (const note of notes) {
        const noteId = String(note._id);
        if (deletedNoteIds.has(noteId)) continue;
        await ctx.db.delete(note._id);
        deletedNoteIds.add(noteId);
        summary.notes += 1;
      }

      const saltCellLogs = await ctx.db
        .query("saltCellLogs")
        .withIndex("by_customer", (q) => q.eq("customer_id", customerId))
        .collect();

      for (const saltCellLog of saltCellLogs) {
        await ctx.db.delete(saltCellLog._id);
        summary.saltCellLogs += 1;
      }

      await ctx.db.delete(customerId);
      summary.customers += 1;
    }

    // 2) Delete remaining user-created general notes.
    const userNotes = await ctx.db
      .query("notes")
      .withIndex("by_created_by", (q) => q.eq("created_by", userEmail))
      .collect();

    for (const note of userNotes) {
      const noteId = String(note._id);
      if (deletedNoteIds.has(noteId)) continue;
      await ctx.db.delete(note._id);
      deletedNoteIds.add(noteId);
      summary.notes += 1;
    }

    // 3) Delete subscription records.
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_user_email", (q) => q.eq("user_email", userEmail))
      .collect();

    for (const subscription of subscriptions) {
      await ctx.db.delete(subscription._id);
      summary.subscriptions += 1;
    }

    // 4) Delete team memberships (owned businesses + direct user memberships).
    const ownedBusinesses = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q) => q.eq("owner_email", userEmail))
      .collect();

    for (const business of ownedBusinesses) {
      const members = await ctx.db
        .query("team_members")
        .withIndex("by_business", (q) => q.eq("business_id", business._id))
        .collect();

      for (const member of members) {
        const memberId = String(member._id);
        if (deletedTeamMemberIds.has(memberId)) continue;
        await ctx.db.delete(member._id);
        deletedTeamMemberIds.add(memberId);
        summary.teamMembers += 1;
      }
    }

    const directMemberships = await ctx.db
      .query("team_members")
      .withIndex("by_user_email", (q) => q.eq("user_email", userEmail))
      .collect();

    for (const member of directMemberships) {
      const memberId = String(member._id);
      if (deletedTeamMemberIds.has(memberId)) continue;
      await ctx.db.delete(member._id);
      deletedTeamMemberIds.add(memberId);
      summary.teamMembers += 1;
    }

    // 5) Delete owned businesses.
    for (const business of ownedBusinesses) {
      await ctx.db.delete(business._id);
      summary.businesses += 1;
    }

    // 6) Delete rate-limit entries keyed to this user id/email.
    const userRateLimitPrefix = `${userEmail}:`;

    const rateLimits = await ctx.db.query("rateLimits").collect();
    for (const entry of rateLimits) {
      if (!entry.key.startsWith(userRateLimitPrefix)) continue;
      await ctx.db.delete(entry._id);
      summary.rateLimits += 1;
    }

    const rateLimitViolations = await ctx.db.query("rateLimitViolations").collect();
    for (const entry of rateLimitViolations) {
      if (!entry.key.startsWith(userRateLimitPrefix)) continue;
      await ctx.db.delete(entry._id);
      summary.rateLimitViolations += 1;
    }

    return {
      success: true,
      userEmail,
      deletedAt: Date.now(),
      deleted: summary,
      warnings,
    };
  },
});
