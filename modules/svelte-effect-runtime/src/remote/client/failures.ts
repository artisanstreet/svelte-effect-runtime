import {
	create_remote_http_error,
	create_remote_transport_error,
	is_serialized_remote_failure_envelope,
} from "$/remote/shared.ts";
import type { RemoteFailure } from "$/remote/shared.ts";
import { RemoteErrorDecodeError } from "$/errors.ts";
import { Option, Schema } from "effect";
import { parse } from "devalue";

type JsonStringDecode =
	| {
			readonly _tag: "JsonStringDecoded";
			readonly value: unknown;
	  }
	| {
			readonly _tag: "JsonStringIgnored";
	  };

type EmbeddedRemoteFailureDecode =
	| {
			readonly _tag: "EmbeddedRemoteFailureDecoded";
			readonly value: unknown;
	  }
	| {
			readonly _tag: "EmbeddedRemoteFailureIgnored";
	  };

type SerializedRemoteFailureDecode<ErrorType> =
	| {
			readonly _tag: "SerializedRemoteFailureDecoded";
			readonly value: RemoteFailure<ErrorType>;
	  }
	| {
			readonly _tag: "SerializedRemoteFailureInvalid";
	  };

const RemoteErrorMessageEnvelopeSchema = Schema.Struct({
	message: Schema.String,
});

const DecodedRemoteFailureSchema = Schema.Struct({
	_tag: Schema.String,
});

const DecodeJsonString = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);
const is_decoded_remote_failure_value = Schema.is(DecodedRemoteFailureSchema);
const is_remote_error_message_envelope = Schema.is(RemoteErrorMessageEnvelopeSchema);

export function decode_remote_error<ErrorType = never>(
	raw: unknown,
	decode?: (encoded: string) => unknown,
): RemoteFailure<ErrorType> | unknown {
	const embedded = decode_embedded_remote_failure(raw);

	if (embedded._tag === "EmbeddedRemoteFailureDecoded") {
		return decode_remote_error<ErrorType>(embedded.value, decode);
	}

	if (is_serialized_remote_failure_envelope(raw)) {
		const decoded = decode_serialized_remote_failure<ErrorType>(raw.encoded, decode);

		if (decoded._tag === "SerializedRemoteFailureInvalid") {
			return create_remote_transport_error(new RemoteErrorDecodeError(raw), raw);
		}

		return decoded.value;
	}

	return raw;
}

function decode_embedded_remote_failure(raw: unknown): EmbeddedRemoteFailureDecode {
	if (typeof raw === "string") {
		return decode_embedded_json_remote_failure(raw);
	}

	if (!is_remote_error_message_envelope(raw)) {
		return { _tag: "EmbeddedRemoteFailureIgnored" };
	}

	return decode_embedded_json_remote_failure(raw.message);
}

function decode_embedded_json_remote_failure(value: string): EmbeddedRemoteFailureDecode {
	const decoded = decode_json_string(value);

	if (decoded._tag === "JsonStringIgnored") {
		return { _tag: "EmbeddedRemoteFailureIgnored" };
	}

	return {
		_tag: "EmbeddedRemoteFailureDecoded",
		value: decoded.value,
	};
}

function decode_json_string(value: string): JsonStringDecode {
	const decoded = DecodeJsonString(value);

	if (!Option.isSome(decoded)) {
		return { _tag: "JsonStringIgnored" };
	}

	return {
		_tag: "JsonStringDecoded",
		value: decoded.value,
	};
}

function decode_serialized_remote_failure<ErrorType>(
	encoded: string,
	decode: ((encoded: string) => unknown) | undefined,
): SerializedRemoteFailureDecode<ErrorType> {
	try {
		const decoded = decode ? decode(encoded) : parse(encoded);

		return {
			_tag: "SerializedRemoteFailureDecoded",
			value: decoded as RemoteFailure<ErrorType>,
		};
	} catch {
		return { _tag: "SerializedRemoteFailureInvalid" };
	}
}

export function is_decoded_remote_failure(value: unknown): value is RemoteFailure<never> {
	return is_decoded_remote_failure_value(value);
}

export function normalize_native_error<ErrorType = never>(
	error: unknown,
): RemoteFailure<ErrorType> {
	const body = get_error_body(error);
	const decoded = decode_remote_error<ErrorType>(body);
	const status = get_error_status(error);

	if (is_decoded_remote_failure(decoded)) {
		return decoded;
	}

	if (status !== undefined) {
		return create_remote_http_error(status, body, error);
	}

	return create_remote_transport_error(error);
}

function get_error_status(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null) {
		return undefined;
	}

	const status = (error as { status?: unknown }).status;

	return typeof status === "number" ? status : undefined;
}

function get_error_body(error: unknown): unknown {
	if (typeof error !== "object" || error === null) {
		return undefined;
	}

	if ("body" in error) {
		return (error as { body?: unknown }).body;
	}

	if ("data" in error) {
		return (error as { data?: unknown }).data;
	}

	return undefined;
}
