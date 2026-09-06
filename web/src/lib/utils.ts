import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Ghep class Tailwind co xu ly xung dot (p-2 + p-4 -> p-4). Moi component shadcn import
// ham nay; init bi bo do nen file duoc tao tay.
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
