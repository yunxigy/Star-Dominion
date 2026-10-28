import { useId } from 'react';
import type { ReactNode } from 'react';

interface BaseControlProps {
  id?: string;
  label: string;
  helpText?: ReactNode;
  disabled?: boolean;
}

interface NumericControlProps extends BaseControlProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number | 'any';
  unit?: ReactNode;
  name?: string;
}

export interface NumberControlProps extends NumericControlProps {
  placeholder?: string;
}

export interface RangeControlProps extends NumericControlProps {}

export interface ToggleControlProps extends BaseControlProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export interface ControlOption<T extends string | number> {
  label: string;
  value: T;
  disabled?: boolean;
}

export interface PresetControlProps<T extends string | number> extends BaseControlProps {
  options: readonly ControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export interface SelectControlProps<T extends string | number> extends BaseControlProps {
  options: readonly ControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  name?: string;
}

function useControlIds(providedId: string | undefined, hasHelpText: boolean) {
  const generatedId = useId();
  const controlId = providedId ?? `image-workbench-control-${generatedId}`;
  return {
    controlId,
    helpId: hasHelpText ? `${controlId}-help` : undefined,
  };
}

function ControlHelp({ id, children }: { id: string | undefined; children: ReactNode }) {
  if (id === undefined) return null;
  return (
    <span id={id} className="image-workbench__control-help">
      {children}
    </span>
  );
}

function readNumber(value: number, onChange: (value: number) => void) {
  if (!Number.isNaN(value)) onChange(value);
}

export function NumberControl({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  name,
  placeholder,
  helpText,
  disabled = false,
}: NumberControlProps) {
  const { controlId, helpId } = useControlIds(id, helpText !== undefined);

  return (
    <div className="image-workbench__control image-workbench__control--number">
      <label className="image-workbench__control-label" htmlFor={controlId}>
        {label}
      </label>
      <div className="image-workbench__number-field">
        <input
          id={controlId}
          className="image-workbench__number-input"
          type="number"
          inputMode="decimal"
          name={name}
          value={value}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={helpId}
          onChange={(event) => readNumber(event.currentTarget.valueAsNumber, onChange)}
        />
        {unit !== undefined ? <span className="image-workbench__control-unit">{unit}</span> : null}
      </div>
      <ControlHelp id={helpId}>{helpText}</ControlHelp>
    </div>
  );
}

export function RangeControl({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  name,
  helpText,
  disabled = false,
}: RangeControlProps) {
  const { controlId, helpId } = useControlIds(id, helpText !== undefined);
  const numberId = `${controlId}-number`;

  return (
    <div className="image-workbench__control image-workbench__control--range">
      <label className="image-workbench__control-label" htmlFor={controlId}>
        {label}
      </label>
      <div className="image-workbench__range-fields">
        <input
          id={controlId}
          className="image-workbench__range-input"
          type="range"
          name={name}
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-describedby={helpId}
          onChange={(event) => readNumber(event.currentTarget.valueAsNumber, onChange)}
        />
        <div className="image-workbench__range-number-field">
          <input
            id={numberId}
            className="image-workbench__range-number"
            type="number"
            inputMode="decimal"
            value={value}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            aria-label={`${label}数值`}
            aria-describedby={helpId}
            onChange={(event) => readNumber(event.currentTarget.valueAsNumber, onChange)}
          />
          {unit !== undefined ? <span className="image-workbench__control-unit">{unit}</span> : null}
        </div>
      </div>
      <ControlHelp id={helpId}>{helpText}</ControlHelp>
    </div>
  );
}

export function ToggleControl({
  id,
  label,
  checked,
  onChange,
  helpText,
  disabled = false,
}: ToggleControlProps) {
  const { controlId, helpId } = useControlIds(id, helpText !== undefined);
  const labelId = `${controlId}-label`;

  return (
    <div className="image-workbench__control image-workbench__control--toggle">
      <span id={labelId} className="image-workbench__control-label">
        {label}
      </span>
      <button
        id={controlId}
        className="image-workbench__toggle"
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={helpId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="image-workbench__toggle-track" aria-hidden="true">
          <span className="image-workbench__toggle-thumb" />
        </span>
      </button>
      <ControlHelp id={helpId}>{helpText}</ControlHelp>
    </div>
  );
}

export function PresetControl<T extends string | number>({
  id,
  label,
  options,
  value,
  onChange,
  helpText,
  disabled = false,
}: PresetControlProps<T>) {
  const { controlId, helpId } = useControlIds(id, helpText !== undefined);

  return (
    <fieldset
      id={controlId}
      className="image-workbench__control image-workbench__control--presets"
      aria-describedby={helpId}
      disabled={disabled}
    >
      <legend className="image-workbench__control-label">{label}</legend>
      <div className="image-workbench__preset-options">
        {options.map((option) => (
          <button
            key={`${typeof option.value}-${String(option.value)}`}
            className="image-workbench__preset"
            type="button"
            aria-pressed={Object.is(option.value, value)}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <ControlHelp id={helpId}>{helpText}</ControlHelp>
    </fieldset>
  );
}

export function SelectControl<T extends string | number>({
  id,
  label,
  options,
  value,
  onChange,
  name,
  helpText,
  disabled = false,
}: SelectControlProps<T>) {
  const { controlId, helpId } = useControlIds(id, helpText !== undefined);

  return (
    <div className="image-workbench__control image-workbench__control--select">
      <label className="image-workbench__control-label" htmlFor={controlId}>
        {label}
      </label>
      <select
        id={controlId}
        className="image-workbench__select"
        name={name}
        value={String(value)}
        disabled={disabled}
        aria-describedby={helpId}
        onChange={(event) => {
          const selected = options.find(
            (option) => String(option.value) === event.currentTarget.value,
          );
          if (selected !== undefined) onChange(selected.value);
        }}
      >
        {options.map((option) => (
          <option
            key={`${typeof option.value}-${String(option.value)}`}
            value={String(option.value)}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      <ControlHelp id={helpId}>{helpText}</ControlHelp>
    </div>
  );
}
