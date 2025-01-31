import {
  getEnabledElementByIds,
  getEnabledElement,
  VolumeViewport,
  BaseVolumeViewport,
  utilities,
} from '@cornerstonejs/core';
import StackScrollTool from './StackScrollTool';
import type { PublicToolProps, ToolProps, EventTypes } from '../types';

/**
 * The StackScrollTool is a tool that allows the user to scroll through a
 * stack of images by pressing the mouse click and dragging
 */
class FusionStackScrollTool extends StackScrollTool {
  static toolName: string;
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
    this.deltaX = 1;
  }

  _scrollDrag(evt: EventTypes.InteractionEventType) {
    const { deltaPoints, element } = evt.detail;
    const enabledElement = getEnabledElement(element);
    const { viewport } = enabledElement;
    const { debounceIfNotLoaded, invert, loop } = this.configuration;
    const deltaPointY = deltaPoints.canvas[1];

    let volumeId;
    if (viewport instanceof VolumeViewport) {
      volumeId = viewport.getVolumeId();

      const isFusion = viewport._actors && viewport._actors.size > 1;
      if (isFusion) {
        const volumeIds = viewport.getAllVolumeIds();
        volumeId = volumeIds[volumeIds.length - 1];
        const properties = viewport.getProperties(volumeId);
        const { opacity } = properties.colormap;
        const opacity_count = (opacity as never[])?.length;
        if (opacity_count) {
          opacity[opacity_count - 1].opacity = this._getFusionNewRange({
            deltaPointsCanvas: deltaPoints.canvas,
            opacity: opacity[opacity_count - 1].opacity,
            clientWidth: element.clientWidth,
          });
        } else {
          properties.colormap.opacity = this._getFusionNewRange({
            deltaPointsCanvas: deltaPoints.canvas,
            opacity,
            clientWidth: element.clientWidth,
          });
        }
        viewport.setProperties(
          {
            colormap: properties.colormap,
          },
          volumeId
        );
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

  _getFusionNewRange({ deltaPointsCanvas, opacity, clientWidth }) {
    const multiplier = 1 / clientWidth;

    const deltaX = deltaPointsCanvas[0];
    const wcDelta = deltaX * multiplier;

    opacity += wcDelta;
    opacity = Math.max(Math.min(0.999, opacity), 0);

    return opacity;
  }
}

FusionStackScrollTool.toolName = 'FusionStackScroll';
export default FusionStackScrollTool;
