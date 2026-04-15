import * as React from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';

export interface AlertDialogProps extends React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Root> { }

declare const AlertDialog: React.FC<AlertDialogProps>;
declare const AlertDialogTrigger: typeof AlertDialogPrimitive.Trigger;
declare const AlertDialogPortal: typeof AlertDialogPrimitive.Portal;
declare const AlertDialogOverlay: React.ForwardRefExoticComponent<
    React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay> & React.RefAttributes<HTMLDivElement>
>;
declare const AlertDialogContent: React.ForwardRefExoticComponent<
    React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> & React.RefAttributes<HTMLDivElement>
>;
declare const AlertDialogHeader: React.FC<React.HTMLAttributes<HTMLDivElement>>;
declare const AlertDialogFooter: React.FC<React.HTMLAttributes<HTMLDivElement>>;
declare const AlertDialogTitle: React.ForwardRefExoticComponent<
    React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title> & React.RefAttributes<HTMLHeadingElement>
>;
declare const AlertDialogDescription: React.ForwardRefExoticComponent<
    React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description> & React.RefAttributes<HTMLParagraphElement>
>;
declare const AlertDialogAction: React.ForwardRefExoticComponent<
    React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action> & React.RefAttributes<HTMLButtonElement>
>;
declare const AlertDialogCancel: React.ForwardRefExoticComponent<
    React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel> & React.RefAttributes<HTMLButtonElement>
>;

export {
    AlertDialog,
    AlertDialogPortal,
    AlertDialogOverlay,
    AlertDialogTrigger,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogAction,
    AlertDialogCancel,
};
