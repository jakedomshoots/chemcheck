import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-95",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-600 bg-[length:200%_100%] hover:bg-[100%_0] transition-[background-position] duration-500 text-white shadow-lg shadow-blue-500/20",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border-2 border-cyan-300 bg-white text-cyan-700 shadow-sm hover:bg-cyan-50 hover:text-cyan-800 hover:border-cyan-400",
        secondary:
          "bg-cyan-100 text-cyan-800 shadow-sm hover:bg-cyan-200",
        ghost: "text-slate-700 hover:bg-cyan-50 hover:text-cyan-700",
        link: "text-cyan-600 underline-offset-4 hover:underline hover:text-cyan-700",
      },
      size: {
        default: "h-10 px-5 py-2.5",
        sm: "h-9 rounded-md px-3 text-xs",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : motion.button
  
  // Only add motion props if it's not a Slot (asChild=false)
  const motionProps = !asChild ? {
    whileHover: { scale: 1.02 },
    whileTap: { scale: 0.95 },
    transition: { type: "spring", stiffness: 400, damping: 17 }
  } : {}

  return (
    (<Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...motionProps}
      {...props} />)
  );
})
Button.displayName = "Button"

export { Button, buttonVariants }
