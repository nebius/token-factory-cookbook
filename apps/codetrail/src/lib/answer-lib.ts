// The answer block library without renderers, for reading an answer's program outside React: the server checks
// its code references, and the browser turns it into Markdown.
import { createLibrary, createParser, defineComponent } from "@openuidev/lang-core";
import { ANSWER_ROOT, answerDescription, answerProps, blockSpecs } from "./answer-schema";

const blocks = Object.entries(blockSpecs).map(([name, spec]) => defineComponent({ name, description: spec.description, props: spec.props, component: null }));
const root = defineComponent({ name: ANSWER_ROOT, description: answerDescription, props: answerProps(blocks.map((b) => b.ref)), component: null });
export const plainLibrary = createLibrary({ components: [root, ...blocks], root: ANSWER_ROOT });

/** The answer's program as a tree of elements. */
export const parseAnswer = (text: string) => createParser(plainLibrary.toJSONSchema(), ANSWER_ROOT).parse(text);
