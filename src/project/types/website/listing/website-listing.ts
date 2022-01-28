/*
* website-listing
.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { basename } from "path/mod.ts";
import { Document } from "deno_dom/deno-dom-wasm-noinit.ts";
import { existsSync } from "fs/mod.ts";

import {
  Format,
  FormatDependency,
  FormatExtras,
  kDependencies,
  kHtmlFinalizers,
  kHtmlPostprocessors,
  kMarkdownAfterBody,
  kSassBundles,
} from "../../../../config/types.ts";
import { ProjectContext } from "../../../types.ts";
import {
  createMarkdownPipeline,
  MarkdownPipelineHandler,
} from "../website-pipeline-md.ts";
import { resourcePath } from "../../../../core/resources.ts";
import { kIncludeInHeader } from "../../../../config/constants.ts";
import { sassLayer } from "../../../../core/sass.ts";
import {
  kBootstrapDependencyName,
  setMainColumn,
} from "../../../../format/html/format-html-shared.ts";
import {
  kFieldCategories,
  Listing,
  ListingDescriptor,
  ListingItem,
  ListingSharedOptions,
  ListingType,
} from "./website-listing-shared.ts";
import {
  templateJsScript,
  templateMarkdownHandler,
} from "./website-listing-template.ts";
import { readListings } from "./website-listing-read.ts";
import { categorySidebar } from "./website-listing-categories.ts";
import { TempContext } from "../../../../core/temp.ts";

export async function listingHtmlDependencies(
  source: string,
  project: ProjectContext,
  format: Format,
  temp: TempContext,
  _extras: FormatExtras,
) {
  // Read and resolve listings from the metadata
  const { listingDescriptors, options } = await readListings(
    source,
    project,
    format,
  );

  // If there no listings, don't inject the dependencies
  if (listingDescriptors.length === 0) {
    return undefined;
  }

  // Create the markdown pipeline for this set of listings
  const markdownHandlers: MarkdownPipelineHandler[] = [];
  listingDescriptors.forEach((listingDescriptor) => {
    markdownHandlers.push(
      markdownHandler(
        format,
        listingDescriptor.listing,
        listingDescriptor.items,
      ),
    );
  });
  const pipeline = createMarkdownPipeline(
    `quarto-listing-pipeline`,
    markdownHandlers,
  );

  // Add the list.js dependency
  const kListingDependency = "quarto-listing";
  const jsPaths = [
    resourcePath("projects/website/listing/list.min.js"),
    resourcePath("projects/website/listing/quarto-listing.js"),
  ];
  const htmlDependencies: FormatDependency[] = [{
    name: kListingDependency,
    scripts: jsPaths.map((path) => {
      return {
        name: basename(path),
        path,
      };
    }),
  }];

  // Generate the inline script tags that configure list.js
  const scripts = listingDescriptors.map((listingItem) => {
    return templateJsScript(
      listingItem.listing.id,
      listingItem.listing,
      listingItem.items.length,
    );
  });

  // Create the post processor
  const listingPostProcessor = (doc: Document) => {
    // Process the rendered listings into the document
    pipeline.processRenderedMarkdown(doc);

    // Do any other processing of the document
    listingPostProcess(
      doc,
      listingDescriptors,
      options,
      format,
    );

    // No resource references to add
    return Promise.resolve([]);
  };

  return {
    [kIncludeInHeader]: [scriptFileForScripts(scripts, temp)],
    [kHtmlPostprocessors]: listingPostProcessor,
    [kMarkdownAfterBody]: pipeline.markdownAfterBody(),
    [kDependencies]: htmlDependencies,
    [kSassBundles]: [listingSassBundle()],
  };
}

function markdownHandler(
  format: Format,
  listing: Listing,
  items: ListingItem[],
) {
  switch (listing.type) {
    case ListingType.Table: {
      return templateMarkdownHandler(
        resourcePath("projects/website/listing/listing-table.ejs.md"),
        listing,
        items,
        format,
      );
    }
    case ListingType.Grid: {
      return templateMarkdownHandler(
        resourcePath("projects/website/listing/listing-grid.ejs.md"),
        listing,
        items,
        format,
      );
    }
    case ListingType.Custom: {
      if (listing.template === undefined) {
        throw new Error(
          "In order to use a listing of type custom, please provide the path to a template.",
        );
      } else {
        if (!existsSync(listing.template)) {
          throw new Error(
            `The template ${listing.template} can't be found.`,
          );
        }
      }
      return templateMarkdownHandler(
        listing.template,
        listing,
        items,
        format,
      );
    }
    case ListingType.Default:
    default: {
      return templateMarkdownHandler(
        resourcePath("projects/website/listing/listing-default.ejs.md"),
        listing,
        items,
        format,
      );
    }
  }
}

function listingPostProcess(
  doc: Document,
  listingDescriptors: ListingDescriptor[],
  options: ListingSharedOptions,
  format: Format,
) {
  // Render categories, if necessary
  const categories = options[kFieldCategories];
  if (categories) {
    const { headingEl, categoriesEl } = categorySidebar(
      doc,
      listingDescriptors,
      format,
      options,
    );
    const rightSidebar = doc.getElementById(kMarginSidebarId);
    rightSidebar?.appendChild(headingEl);
    rightSidebar?.appendChild(categoriesEl);
  }
}

const kMarginSidebarId = "quarto-margin-sidebar";

function scriptFileForScripts(scripts: string[], temp: TempContext) {
  const scriptFile = temp.createFile({ suffix: "html" });
  const contents = `<script>\n${scripts.join("\n")}</script>`;
  Deno.writeTextFileSync(scriptFile, contents);
  return scriptFile;
}

function listingSassBundle() {
  const scssPath = resourcePath("projects/website/listing/quarto-listing.scss");
  const layer = sassLayer(scssPath);
  return {
    dependency: kBootstrapDependencyName,
    key: scssPath,
    quarto: {
      name: "quarto-listing.css",
      ...layer,
    },
  };
}