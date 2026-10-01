import { createContext, useContext } from "react";
import type { Computer, ComputerRegistry } from "../state/computers.js";

export const ComputerContext = createContext<{ registry: ComputerRegistry; active: Computer | null; manage: (computerId?: string) => void; about: () => void } | null>(null);
export function useComputers() { return useContext(ComputerContext); }
