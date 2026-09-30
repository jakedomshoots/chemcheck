import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

declare const Dialog: typeof DialogPrimitive.Root;
declare const DialogTrigger: typeof DialogPrimitive.Trigger;
declare const DialogPortal: typeof DialogPrimitive.Portal;
declare const DialogClose: typeof DialogPrimitive.Close;
declare const DialogOverlay: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & React.RefAttributes<HTMLDivElement>
>;
declare const DialogContent: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & React.RefAttributes<HTMLDivElement>
>;
declare const DialogHeader: (props: React.HTMLAttributes<HTMLDivElement>) => React.JSX.Element;
declare const DialogFooter: (props: React.HTMLAttributes<HTMLDivElement>) => React.JSX.Element;
declare const DialogTitle: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title> & React.RefAttributes<HTMLHeadingElement>
>;
declare const DialogDescription: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description> & React.RefAttributes<HTMLParagraphElement>
>;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
