"use client";

import { useEffect, useState } from "react";

/**
 * Hoan gia tri lai `delayMs` sau lan doi cuoi. Dung cho o tim kiem: khong co no thi go
 * "1243516" la bay request, moi request mot lan quet bang User.
 */
export function useDebounced<T>(value: T, delayMs = 350): T {
    const [settled, setSettled] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), delayMs);
        return () => clearTimeout(timer);
    }, [value, delayMs]);

    return settled;
}
