import type { ReactNode } from "react";
import type { ShaderCorrectionParams } from "../../webgl/types";

export type ShaderSaveStatus = "idle" | "saved" | "error";

export interface ReaderShaderSheetProps {
  readonly isOpen: boolean;
  readonly shaderParams: ShaderCorrectionParams;
  readonly saveStatus?: ShaderSaveStatus;
  readonly onChangeShaderParams: (next: ShaderCorrectionParams) => void;
  readonly onReset: () => void;
  readonly onSaveDefault: () => void;
  readonly onClose: () => void;
}

export function ReaderShaderSheet(_props: ReaderShaderSheetProps): ReactNode {
  return null;
}
