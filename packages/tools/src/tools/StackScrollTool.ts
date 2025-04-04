import {
  getEnabledElementByIds,
  getEnabledElement,
  VolumeViewport,
  BaseVolumeViewport,
  cache,
  utilities,
} from '@cornerstonejs/core';
import { BaseTool } from './base';
import type { PublicToolProps, ToolProps, EventTypes } from '../types';
import type { IDynamicImageVolume } from '@cornerstonejs/core/types';

/**
 * The StackScrollTool is a tool that allows the user to scroll through a
 * stack of images by pressing the mouse click and dragging
 */
class StackScrollTool extends BaseTool {
  static toolName;
  deltaY: number;
  deltaX: number;
  constructor(
    toolProps: PublicToolProps = {},
    defaultToolProps: ToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        invert: false,
        debounceIfNotLoaded: true,
        loop: false,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
    this.deltaY = 1;
    this.deltaX = 1;
  }

  mouseWheelCallback(evt: EventTypes.MouseWheelEventType) {
    // based on configuration, we decide if we want to scroll or rotate
    this._scroll(evt);
  }

  mouseDragCallback(evt: EventTypes.InteractionEventType) {
    this._dragCallback(evt);
  }
  touchDragCallback(evt: EventTypes.InteractionEventType) {
    this._dragCallback(evt);
  }

  _dragCallback(evt: EventTypes.InteractionEventType) {
    this._scrollDrag(evt);
  }

  _scrollDrag(evt: EventTypes.InteractionEventType) {
    const {
      deltaPoints,
      viewportId,
      renderingEngineId,
      startPoints,
      lastPoints,
    } = evt.detail;
    const { viewport } = getEnabledElementByIds(viewportId, renderingEngineId);
    const { debounceIfNotLoaded, invert, loop } = this.configuration;
    const deltaPointY = deltaPoints.canvas[1];

    let volumeId;
    if (viewport instanceof VolumeViewport) {
      const diff = [
        Math.abs(startPoints.canvas[0] - lastPoints.canvas[0]),
        Math.abs(startPoints.canvas[1] - lastPoints.canvas[1]),
      ];
      if (!diff.some((delta: number) => delta > 10)) {
        return;
      }
      volumeId = viewport.getVolumeId();
      const volume = cache.getVolume(volumeId);
      if (diff[0] > diff[1] && volume.isDynamicVolume()) {
        const dynamicVolume = volume as IDynamicImageVolume;
        const pixelsPerGroup = this._getPixelPerGroup(
          viewport,
          volume.numTimePoints
        );
        if (!pixelsPerGroup) {
          return;
        }
        const deltaX = deltaPoints.canvas[0] + this.deltaX;
        if (Math.abs(deltaX) >= pixelsPerGroup) {
          const groupOffset = Math.round(deltaX / pixelsPerGroup);
          const newDimensionGroupNumber =
            dynamicVolume.dimensionGroupNumber + groupOffset;
          dynamicVolume.dimensionGroupNumber = Math.max(
            1,
            Math.min(newDimensionGroupNumber, dynamicVolume.numDimensionGroups)
          );

          this.deltaX = deltaX % pixelsPerGroup;
        } else {
          this.deltaX = deltaX;
        }
        return;
      }
    }

    const pixelsPerImage = this._getPixelPerImage(viewport);
    const deltaY = deltaPointY + this.deltaY;

    if (!pixelsPerImage) {
      return;
    }

    if (Math.abs(deltaY) >= pixelsPerImage) {
      const imageIdIndexOffset = Math.round(deltaY / pixelsPerImage);

      utilities.scroll(viewport, {
        delta: invert ? -imageIdIndexOffset : imageIdIndexOffset,
        volumeId,
        debounceLoading: debounceIfNotLoaded,
        loop: loop,
      });

      this.deltaY = deltaY % pixelsPerImage;
    } else {
      this.deltaY = deltaY;
    }
  }

  /**
   * Allows binding to the mouse wheel for performing stack scrolling.
   */
  _scroll(evt: EventTypes.MouseWheelEventType): void {
    const { wheel, element } = evt.detail;
    const { direction } = wheel;
    const { invert } = this.configuration;
    const { viewport } = getEnabledElement(element);
    const delta = direction * (invert ? -1 : 1);

    utilities.scroll(viewport, {
      delta,
      debounceLoading: this.configuration.debounceIfNotLoaded,
      loop: this.configuration.loop,
      volumeId:
        viewport instanceof BaseVolumeViewport
          ? viewport.getVolumeId()
          : undefined,
      scrollSlabs: this.configuration.scrollSlabs,
    });
  }

  _getPixelPerImage(viewport) {
    const { element } = viewport;
    const numberOfSlices = viewport.getNumberOfSlices();

    // The Math.max here makes it easier to mouseDrag-scroll small or really large image stacks
    return Math.max(2, element.offsetHeight / Math.max(numberOfSlices, 8));
  }

  _getPixelPerGroup(viewport, numTimepoints) {
    const { element } = viewport;

    // The Math.max here makes it easier to mouseDrag-scroll small or really large image stacks
    return Math.max(2, element.offsetWidth / Math.max(numTimepoints, 8));
  }
}

StackScrollTool.toolName = 'StackScroll';
export default StackScrollTool;
