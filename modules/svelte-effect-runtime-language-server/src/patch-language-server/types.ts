// deno-lint-ignore-file no-explicit-any
export type Mapper = {
  getOriginalPosition(position: any): any;
  getGeneratedPosition(position: any): any;
  isInGenerated(position: any): boolean;
};

export type Relocation = {
  originalStart: number;
  originalEnd: number;
  generatedStart: number;
  generatedEnd: number;
};

export type TransformResult = {
  code: string;
  map?: Record<string, unknown>;
  relocations?: Array<Relocation>;
};

export type RequiredTransformResult = {
  code: string;
  map: Record<string, unknown>;
  relocations?: Array<Relocation>;
};

export type TransformSet = {
  transformEffectMarkup: (
    code: string,
    options: { filename: string },
  ) => RequiredTransformResult;
  transformEffectScript: (
    code: string,
    options: { filename: string },
  ) => RequiredTransformResult;
};
