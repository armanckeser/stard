import { createFileRoute } from "@tanstack/react-router";
import { AllStarsPage, searchSchema } from "./index";

// The stars organizer at an address of its own, for people who search for one: "/" opens on Play.
export const Route = createFileRoute("/organize")({
  component: AllStarsPage,
  validateSearch: searchSchema,
});
