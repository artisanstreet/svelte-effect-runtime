export type DocumentPosition = {
	line: number;
	character: number;
};

export type Mapper = {
	getOriginalPosition(position: DocumentPosition): DocumentPosition;
	getGeneratedPosition(position: DocumentPosition): DocumentPosition;
	isInGenerated(position: DocumentPosition): boolean;
};

export type FragmentTagInfo = {
	content: string;
	[key: string]: unknown;
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
	transformEffectMarkup: (code: string, options: { filename: string }) => RequiredTransformResult;
	transformEffectScript: (code: string, options: { filename: string }) => RequiredTransformResult;
};
