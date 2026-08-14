"use client";

import { useState, useTransition } from "react";
import { createOrder } from "./actions";
import type { CustomerOption } from "./queue-types";

const inputClass =
  "rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500";

export function NewOrderForm({ customers }: { customers: CustomerOption[] }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [reference, setReference] = useState("");
  const [cod, setCod] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onNameChange(value: string) {
    setName(value);
    // Autocomplete: picking a known customer fills phone + default address.
    const match = customers.find((c) => c.name === value);
    if (match) {
      setPhone(match.phone);
      if (match.default_address) setAddress(match.default_address);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createOrder({
        customerName: name,
        phone,
        address,
        reference: reference || undefined,
        codAmount: cod === "" ? null : Number(cod),
        notes: notes || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      setPhone("");
      setAddress("");
      setReference("");
      setCod("");
      setNotes("");
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex h-fit flex-col gap-2 rounded border border-neutral-800 p-4"
    >
      <h2 className="font-display">New order</h2>
      <label className="mt-1 text-xs text-neutral-400" htmlFor="customer">
        Customer
      </label>
      <input
        id="customer"
        list="customer-list"
        required
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Name"
        className={inputClass}
      />
      <datalist id="customer-list">
        {customers.map((c) => (
          <option key={`${c.phone}-${c.name}`} value={c.name}>
            {c.phone}
          </option>
        ))}
      </datalist>
      <input
        aria-label="Phone"
        required
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Phone (+234…)"
        className={inputClass}
      />
      <label className="mt-1 text-xs text-neutral-400" htmlFor="address">
        Drop-off address
      </label>
      <input
        id="address"
        required
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Street, area, city"
        className={inputClass}
      />
      <div className="flex gap-2">
        <input
          aria-label="Order reference"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Reference (optional)"
          className={`${inputClass} min-w-0 flex-1`}
        />
        <input
          aria-label="COD amount"
          type="number"
          min="0"
          step="0.01"
          value={cod}
          onChange={(e) => setCod(e.target.value)}
          placeholder="COD ₦"
          className={`${inputClass} w-28`}
        />
      </div>
      <input
        aria-label="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className={inputClass}
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded bg-neutral-100 px-4 py-2.5 text-sm font-medium text-base disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create order"}
      </button>
    </form>
  );
}
