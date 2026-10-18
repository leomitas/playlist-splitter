// @vitest-environment jsdom
// Segmented control: radio-group semantics, roving tabindex and keyboard selection.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Segmented } from "@/app/segmented";

afterEach(cleanup);

const OPTIONS = [
  { value: "size", label: "Tamanho" },
  { value: "name", label: "Nome" },
  { value: "review", label: "A revisar" },
] as const;

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState<string>("name");
  return (
    <>
      <button>antes</button>
      <Segmented
        label="Ordenar por"
        options={[...OPTIONS]}
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
      />
      <button>depois</button>
    </>
  );
}

const radio = (name: string) => screen.getByRole("radio", { name });

describe("Segmented", () => {
  it("is a labelled radiogroup with exactly one checked option", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Ordenar por" })).toBeTruthy();
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  });

  it("Tab enters on the checked option and the next Tab leaves the group", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "antes" }));
    await user.tab();
    expect(document.activeElement).toBe(radio("Nome"));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "depois" }));
  });

  it("arrows move focus and select, wrapping around; Home and End jump", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    radio("Nome").focus();

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(radio("A revisar"));
    expect(radio("A revisar").getAttribute("aria-checked")).toBe("true");

    await user.keyboard("{ArrowRight}");
    expect(radio("Tamanho").getAttribute("aria-checked")).toBe("true");

    await user.keyboard("{ArrowLeft}");
    expect(radio("A revisar").getAttribute("aria-checked")).toBe("true");

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(radio("Tamanho"));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(radio("A revisar"));

    expect(onChange.mock.calls.map((c) => c[0])).toEqual(["review", "size", "review", "size", "review"]);
    // only the checked option is in the tab order
    expect(screen.getAllByRole("radio").map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
  });

  it("a click selects; clicking the checked option doesn't fire onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(radio("Nome"));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(radio("Tamanho"));
    expect(onChange).toHaveBeenCalledWith("size");
    expect(radio("Tamanho").getAttribute("aria-checked")).toBe("true");
  });
});
