/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as businesses from "../businesses.js";
import type * as chemicalUsage from "../chemicalUsage.js";
import type * as communications from "../communications.js";
import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as invoices from "../invoices.js";
import type * as migrations from "../migrations.js";
import type * as notes from "../notes.js";
import type * as payments from "../payments.js";
import type * as quotes from "../quotes.js";
import type * as rateLimit from "../rateLimit.js";
import type * as serviceLogs from "../serviceLogs.js";
import type * as servicePhotos from "../servicePhotos.js";
import type * as serviceReports from "../serviceReports.js";
import type * as stripeEvents from "../stripeEvents.js";
import type * as stripeWebhook from "../stripeWebhook.js";
import type * as subscriptions from "../subscriptions.js";
import type * as sync from "../sync.js";
import type * as tax from "../tax.js";
import type * as validation from "../validation.js";
import type * as workOrders from "../workOrders.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  businesses: typeof businesses;
  chemicalUsage: typeof chemicalUsage;
  communications: typeof communications;
  crons: typeof crons;
  customers: typeof customers;
  health: typeof health;
  http: typeof http;
  invoices: typeof invoices;
  migrations: typeof migrations;
  notes: typeof notes;
  payments: typeof payments;
  quotes: typeof quotes;
  rateLimit: typeof rateLimit;
  serviceLogs: typeof serviceLogs;
  servicePhotos: typeof servicePhotos;
  serviceReports: typeof serviceReports;
  stripeEvents: typeof stripeEvents;
  stripeWebhook: typeof stripeWebhook;
  subscriptions: typeof subscriptions;
  sync: typeof sync;
  tax: typeof tax;
  validation: typeof validation;
  workOrders: typeof workOrders;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
