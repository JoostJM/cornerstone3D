/* eslint-disable @typescript-eslint/no-empty-function */
import {vec2, vec3} from 'gl-matrix';

import {
  getEnabledElement,
  VolumeViewport,
  utilities as csUtils, StackViewport, utilities,
} from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';

import { AnnotationTool } from './base';
import {
  addAnnotation,
  getAnnotations,
  removeAnnotation,
} from '../stateManagement/annotation/annotationState';
import {
  triggerAnnotationCompleted,
  triggerAnnotationModified,
} from '../stateManagement/annotation/helpers/state';
import { getCalibratedProbeUnitsAndValue } from '../utilities';
import {
  drawHandles as drawHandlesSvg, drawLine,
  drawTextBox as drawTextBoxSvg,
} from '../drawingSvg';
import { state } from '../store';
import { Events } from '../enums';
import { getViewportIdsWithToolToRender } from '../utilities/viewportFilters';
import { roundNumber } from '../utilities';
import {
  resetElementCursor,
  hideElementCursor,
} from '../cursors/elementCursor';

import triggerAnnotationRenderForViewportIds from '../utilities/triggerAnnotationRenderForViewportIds';

import {
  EventTypes,
  ToolHandle,
  PublicToolProps,
  ToolProps,
  SVGDrawingHelper, Annotations,
} from '../types';
import { ProbeAnnotation } from '../types/ToolSpecificAnnotationTypes';
import { StyleSpecifier } from '../types/AnnotationStyle';
import {
  ModalityUnitOptions,
  getModalityUnit,
} from '../utilities/getModalityUnit';
import { isViewportPreScaled } from '../utilities/viewport/isViewportPreScaled';
import {isAnnotationVisible} from "../stateManagement/annotation/annotationVisibility";

const { transformWorldToIndex } = csUtils;

/**
 * ProbeTool let you get the underlying voxel value by putting a probe in that
 * location. It will give index of the location and value of the voxel.
 * You can use ProbeTool in all perpendicular views (axial, sagittal, coronal).
 * Note: annotation tools in cornerstone3DTools exists in the exact location
 * in the physical 3d space, as a result, by default, all annotations that are
 * drawing in the same frameOfReference will get shared between viewports that
 * are in the same frameOfReference. Probe tool's text box are dynamically
 * generated based on the viewport's underlying Modality. For instance, if
 * the viewport is displaying CT, the text box will shown the statistics in Hounsfield units,
 * and if the viewport is displaying PET, the text box will show the statistics in
 * SUV units.
 *
 * The resulting annotation's data (statistics) and metadata (the
 * state of the viewport while drawing was happening) will get added to the
 * ToolState manager and can be accessed from the ToolState by calling getAnnotations
 * or similar methods.
 *
 * To use the ProbeTool, you first need to add it to cornerstoneTools, then create
 * a toolGroup and add the ProbeTool to it. Finally, setToolActive on the toolGroup
 *
 * ```js
 * cornerstoneTools.addTool(ProbeTool)
 *
 * const toolGroup = ToolGroupManager.createToolGroup('toolGroupId')
 *
 * toolGroup.addTool(ProbeTool.toolName)
 *
 * toolGroup.addViewport('viewportId', 'renderingEngineId')
 *
 * toolGroup.setToolActive(ProbeTool.toolName, {
 *   bindings: [
 *    {
 *       mouseButton: MouseBindings.Primary, // Left Click
 *     },
 *   ],
 * })
 * ```
 *
 * Read more in the Docs section of the website.
 *
 */

class ReferenceProbe extends AnnotationTool {
  static toolName;

  touchDragCallback: any;
  mouseDragCallback: any;
  editData: {
    annotation: any;
    viewportIdsToRender: string[];
    newAnnotation?: boolean;
  } | null;
  eventDispatchDetail: {
    viewportId: string;
    renderingEngineId: string;
  };
  isDrawing: boolean;
  isHandleOutsideImage: boolean;

  _elementWithCursor: null | HTMLDivElement = null;
  _currentCursorWorldPosition: null | Types.Point3 = null;
  _currentCanvasPosition: null | Types.Point2 = null;

  constructor(
    toolProps: PublicToolProps = {},
    defaultToolProps: ToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        shadow: true,
        preventHandleOutsideImage: false,
        displayThreshold: 5,
        positionSync: true,
        disableCursor: false,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
  }

  // Not necessary for this tool but needs to be defined since it's an abstract
  // method from the parent class.
  isPointNearTool(): boolean {
    return false;
  }

  toolSelectedCallback() {}

  /**
   * Based on the current position of the mouse and the current imageId to create
   * a Probe Annotation and stores it in the annotationManager
   *
   * @param evt -  EventTypes.NormalizedMouseEventType
   * @returns The annotation object.
   *
   */
  addNewAnnotation = (
    evt: EventTypes.InteractionEventType
  ): ProbeAnnotation => {
    const eventDetail = evt.detail;
    const { currentPoints, element } = eventDetail;
    const worldPos = currentPoints.world;

    const enabledElement = getEnabledElement(element);
    const { viewport, renderingEngine } = enabledElement;

    this.isDrawing = true;
    const camera = viewport.getCamera();
    const { viewPlaneNormal, viewUp } = camera;

    //save current positions and current element the curser is hovering over
    this._currentCursorWorldPosition = currentPoints.world;
    this._currentCanvasPosition = currentPoints.canvas;
    this._elementWithCursor = element;

    const referencedImageId = this.getReferencedImageId(
      viewport,
      worldPos,
      viewPlaneNormal,
      viewUp
    );

    const FrameOfReferenceUID = viewport.getFrameOfReferenceUID();

    const annotation = {
      highlighted: true,
      invalidated: true,
      metadata: {
        toolName: this.getToolName(),
        viewPlaneNormal: <Types.Point3>[...viewPlaneNormal],
        viewUp: <Types.Point3>[...viewUp],
        FrameOfReferenceUID,
        referencedImageId,
      },
      data: {
        label: '',
        handles: {
          points: [[...worldPos]] as [Types.Point3],
          activeHandleIndex: null,
          textBox: {
            hasMoved: false,
            worldPosition: <Types.Point3>[0, 0, 0],
            worldBoundingBox: {
              topLeft: <Types.Point3>[0, 0, 0],
              topRight: <Types.Point3>[0, 0, 0],
              bottomLeft: <Types.Point3>[0, 0, 0],
              bottomRight: <Types.Point3>[0, 0, 0],
            },
          },
        },
        cachedStats: {},
      },
    };

    addAnnotation(annotation, element);

    const viewportIdsToRender = getViewportIdsWithToolToRender(
      element,
      this.getToolName(),
      false
    );

    this.editData = {
      annotation,
      newAnnotation: true,
      viewportIdsToRender,
    };
    this._activateModify(element);

    hideElementCursor(element);

    evt.preventDefault();

    triggerAnnotationRenderForViewportIds(renderingEngine, viewportIdsToRender);

    return annotation;
  };

  /**
   * It checks if the mouse click is near ProveTool, it overwrites the baseAnnotationTool
   * getHandleNearImagePoint method.
   *
   * @param element - The element that the tool is attached to.
   * @param annotation - The annotation object associated with the annotation
   * @param canvasCoords - The coordinates of the mouse click on canvas
   * @param proximity - The distance from the mouse cursor to the point
   * that is considered "near".
   * @returns The handle that is closest to the cursor, or null if the cursor
   * is not near any of the handles.
   */
  getHandleNearImagePoint(
    element: HTMLDivElement,
    annotation: ProbeAnnotation,
    canvasCoords: Types.Point2,
    proximity: number
  ): ToolHandle | undefined {
    const enabledElement = getEnabledElement(element);
    const { viewport } = enabledElement;

    const { data } = annotation;
    const point = data.handles.points[0];
    const annotationCanvasCoordinate = viewport.worldToCanvas(point);

    const near =
      vec2.distance(canvasCoords, annotationCanvasCoordinate) < proximity;

    if (near === true) {
      return point;
    }
  }

  handleSelectedCallback(
    evt: EventTypes.InteractionEventType,
    annotation: ProbeAnnotation
  ): void {
    const eventDetail = evt.detail;
    const { element } = eventDetail;

    annotation.highlighted = true;

    const viewportIdsToRender = getViewportIdsWithToolToRender(
      element,
      this.getToolName()
    );

    // Find viewports to render on drag.

    this.editData = {
      //handle, // This would be useful for other tools with more than one handle
      annotation,
      viewportIdsToRender,
    };
    this._activateModify(element);

    hideElementCursor(element);

    const enabledElement = getEnabledElement(element);
    const { renderingEngine } = enabledElement;

    triggerAnnotationRenderForViewportIds(renderingEngine, viewportIdsToRender);

    evt.preventDefault();
  }

  _endCallback = (evt: EventTypes.InteractionEventType): void => {
    const eventDetail = evt.detail;
    const { element } = eventDetail;

    const { annotation, viewportIdsToRender, newAnnotation } = this.editData;

    const { viewportId, renderingEngine } = getEnabledElement(element);
    this.eventDispatchDetail = {
      viewportId,
      renderingEngineId: renderingEngine.id,
    };

    this._deactivateModify(element);

    resetElementCursor(element);

    this.editData = null;
    this.isDrawing = false;

    /*if (
      this.isHandleOutsideImage &&
      this.configuration.preventHandleOutsideImage
    ) {*/
    removeAnnotation(annotation.annotationUID);
    //}

    triggerAnnotationRenderForViewportIds(renderingEngine, viewportIdsToRender);

    /*if (newAnnotation) {
      triggerAnnotationCompleted(annotation);
    }*/
  };

  _dragCallback = (evt) => {
    this.isDrawing = true;
    const eventDetail = evt.detail;
    const { currentPoints, element } = eventDetail;
    const worldPos = currentPoints.world;

    const { annotation, viewportIdsToRender } = this.editData;
    const { data } = annotation;

    //save current positions and current element the curser is hovering over
    this._currentCursorWorldPosition = currentPoints.world;
    this._currentCanvasPosition = currentPoints.canvas;
    this._elementWithCursor = element;

    data.handles.points[0] = [...worldPos];
    annotation.invalidated = true;

    const enabledElement = getEnabledElement(element);
    const { renderingEngine } = enabledElement;

    triggerAnnotationRenderForViewportIds(renderingEngine, viewportIdsToRender);
  };

  cancel = (element: HTMLDivElement) => {
    // If it is mid-draw or mid-modify
    if (this.isDrawing) {
      this.isDrawing = false;
      this._deactivateModify(element);
      resetElementCursor(element);

      const { annotation, viewportIdsToRender, newAnnotation } = this.editData;
      const { data } = annotation;

      annotation.highlighted = false;
      data.handles.activeHandleIndex = null;

      const { renderingEngine } = getEnabledElement(element);

      triggerAnnotationRenderForViewportIds(
        renderingEngine,
        viewportIdsToRender
      );

      /*if (newAnnotation) {
        triggerAnnotationCompleted(annotation);
      }*/

      this.editData = null;
      return annotation.annotationUID;
    }
  };

  _activateModify = (element) => {
    state.isInteractingWithTool = true;

    element.addEventListener(Events.MOUSE_UP, this._endCallback);
    element.addEventListener(Events.MOUSE_DRAG, this._dragCallback);
    element.addEventListener(Events.MOUSE_CLICK, this._endCallback);

    element.addEventListener(Events.TOUCH_END, this._endCallback);
    element.addEventListener(Events.TOUCH_DRAG, this._dragCallback);
    element.addEventListener(Events.TOUCH_TAP, this._endCallback);
  };

  _deactivateModify = (element) => {
    state.isInteractingWithTool = false;
    element.removeEventListener(Events.MOUSE_UP, this._endCallback);
    element.removeEventListener(Events.MOUSE_DRAG, this._dragCallback);
    element.removeEventListener(Events.MOUSE_CLICK, this._endCallback);

    element.removeEventListener(Events.TOUCH_END, this._endCallback);
    element.removeEventListener(Events.TOUCH_DRAG, this._dragCallback);
    element.removeEventListener(Events.TOUCH_TAP, this._endCallback);
  };

  /**
   * it is used to draw the probe annotation in each
   * request animation frame. It calculates the updated cached statistics if
   * data is invalidated and cache it.
   *
   * @param enabledElement - The Cornerstone's enabledElement.
   * @param svgDrawingHelper - The svgDrawingHelper providing the context for drawing.
   */
  renderAnnotation = (
    enabledElement: Types.IEnabledElement,
    svgDrawingHelper: SVGDrawingHelper
  ): boolean => {
    let renderStatus = false;
    const { viewport } = enabledElement;
    const { element } = viewport;

    const isElementWithCursor = this._elementWithCursor === element;

    //update stack position if position sync is enabled
    if (this.configuration.positionSync && !isElementWithCursor) {
      this.updateViewportImage(viewport);
    }

    let annotations = getAnnotations(this.getToolName(), element);

    if (!annotations?.length) {
      return renderStatus;
    }

    annotations = this.filterInteractableAnnotationsForElement(
      element,
      annotations
    );

    if (!annotations?.length) {
      return renderStatus;
    }

    const styleSpecifier: StyleSpecifier = {
      toolGroupId: this.toolGroupId,
      toolName: this.getToolName(),
      viewportId: enabledElement.viewport.id,
    };

    for (let i = 0; i < annotations.length; i++) {
      const annotation = annotations[i] as ProbeAnnotation;
      const annotationUID = annotation.annotationUID;
      const data = annotation.data;
      const { points } = data.handles;

      styleSpecifier.annotationUID = annotationUID;

      const { color, lineWidth, lineDash } = this.getAnnotationStyle({
        annotation,
        styleSpecifier,
      });

      if (points[0].some((e) => isNaN(e))) {
        return renderStatus;
      }

      const canvasCoordinates = points.map((p) =>
        viewport.worldToCanvas(p)
      ) as [Types.Point2];

      // If rendering engine has been destroyed while rendering
      if (!viewport.getRenderingEngine()) {
        console.warn('Rendering Engine has been destroyed');
        return renderStatus;
      }

      if (!isAnnotationVisible(annotationUID)) {
        return renderStatus;
      }

      const crosshairUIDs = {
        upper: 'upper',
        right: 'right',
        lower: 'lower',
        left: 'left',
      };
      const [x, y] = canvasCoordinates[0];
      const centerSpace = isElementWithCursor ? 20 : 7;
      const lineLength = isElementWithCursor ? 5 : 7;
      drawLine(
        svgDrawingHelper,
        annotationUID,
        crosshairUIDs.upper,
        [x, y - (centerSpace / 2 + lineLength)],
        [x, y - centerSpace / 2],
        { color, lineDash, lineWidth }
      );
      drawLine(
        svgDrawingHelper,
        annotationUID,
        crosshairUIDs.lower,
        [x, y + (centerSpace / 2 + lineLength)],
        [x, y + centerSpace / 2],
        { color, lineDash, lineWidth }
      );
      drawLine(
        svgDrawingHelper,
        annotationUID,
        crosshairUIDs.right,
        [x + (centerSpace / 2 + lineLength), y],
        [x + centerSpace / 2, y],
        { color, lineDash, lineWidth }
      );
      drawLine(
        svgDrawingHelper,
        annotationUID,
        crosshairUIDs.left,
        [x - (centerSpace / 2 + lineLength), y],
        [x - centerSpace / 2, y],
        { color, lineDash, lineWidth }
      );

      renderStatus = true;
    }

    return renderStatus;
  };

  //display annotation if current viewing plane has a max distance of "displayThreshold" from the annotation
  filterInteractableAnnotationsForElement(
    element: HTMLDivElement,
    annotations: Annotations
  ): Annotations {
    //calculate distance of current viewport to annotation
    if (!(annotations instanceof Array) || annotations.length === 0) {
      return [];
    }
    const annotation = annotations[0];
    const viewport = getEnabledElement(element)?.viewport;
    if (!viewport) {
      return [];
    }
    const camera = viewport.getCamera();
    const { viewPlaneNormal, focalPoint } = camera;
    if (!viewPlaneNormal || !focalPoint) {
      return [];
    }
    const points = annotation.data?.handles?.points;
    if (!(points instanceof Array) || points.length !== 1) {
      return [];
    }
    const worldPos = points[0];
    const plane = utilities.planar.planeEquation(viewPlaneNormal, focalPoint);
    const distance = utilities.planar.planeDistanceToPoint(plane, worldPos);
    return distance < this.configuration.displayThreshold ? [annotation] : [];
  }

  updateViewportImage(
    viewport: Types.IStackViewport | Types.IVolumeViewport
  ): void {
    const currentMousePosition = this._currentCursorWorldPosition;

    if (!currentMousePosition || currentMousePosition.some((e) => isNaN(e))) {
      return;
    }

    if (viewport instanceof StackViewport) {
      const closestIndex = utilities.getClosestStackImageIndexForPoint(
        currentMousePosition,
        viewport
      );

      if (closestIndex === null) {
        return;
      }
      if (closestIndex !== viewport.getCurrentImageIdIndex()) {
        viewport.setImageIdIndex(closestIndex);
      }
    } else if (viewport instanceof VolumeViewport) {
      const { focalPoint, viewPlaneNormal } = viewport.getCamera();
      if (!focalPoint || !viewPlaneNormal) {
        return;
      }
      const plane = utilities.planar.planeEquation(viewPlaneNormal, focalPoint);
      const currentDistance = utilities.planar.planeDistanceToPoint(
        plane,
        currentMousePosition,
        true
      );

      if (Math.abs(currentDistance) < 0.5) {
        return;
      }
      const normalizedViewPlane = vec3.normalize(
        vec3.create(),
        vec3.fromValues(...viewPlaneNormal)
      );
      const scaledPlaneNormal = vec3.scale(
        vec3.create(),
        normalizedViewPlane,
        currentDistance
      );
      const newFocalPoint = vec3.add(
        vec3.create(),
        vec3.fromValues(...focalPoint),
        scaledPlaneNormal
      ) as Types.Point3;
      //TODO: make check if new focal point is within bounds of volume
      const isInBounds = true;
      if (isInBounds) {
        viewport.setCamera({ focalPoint: newFocalPoint });
        const renderingEngine = viewport.getRenderingEngine();
        if (renderingEngine) {
          renderingEngine.renderViewport(viewport.id);
        }
      }
    }
  }
}

ReferenceProbe.toolName = 'ReferenceProbe';
export default ReferenceProbe;
