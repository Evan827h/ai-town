import { BaseTexture, ISpritesheetData, Spritesheet } from 'pixi.js';
import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatedSprite, Container, Graphics, Text } from '@pixi/react';
import * as PIXI from 'pixi.js';

const BUBBLE_DISPLAY_TIME = 8000;
const BUBBLE_MAX_CHARS = 80;
const BUBBLE_MAX_WIDTH = 120;
const BUBBLE_PADDING = 6;
const BUBBLE_FONT_SIZE = 10;

const bubbleTextStyle = new PIXI.TextStyle({
  fontSize: BUBBLE_FONT_SIZE,
  fontFamily: 'Arial',
  fill: 0x222222,
  wordWrap: true,
  wordWrapWidth: BUBBLE_MAX_WIDTH - BUBBLE_PADDING * 2,
  lineHeight: BUBBLE_FONT_SIZE + 2,
});

function SpeechBubble({ text }: { text: string }) {
  const truncated = text.length > BUBBLE_MAX_CHARS ? text.slice(0, BUBBLE_MAX_CHARS - 1) + '…' : text;
  const metrics = PIXI.TextMetrics.measureText(truncated, bubbleTextStyle);
  const boxW = Math.min(BUBBLE_MAX_WIDTH, metrics.width + BUBBLE_PADDING * 2);
  const boxH = metrics.height + BUBBLE_PADDING * 2;
  const triSize = 4;

  const drawBg = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      // White rounded-rect background
      g.beginFill(0xffffff, 0.95);
      g.lineStyle(1, 0xbbbbbb, 1);
      g.drawRoundedRect(-boxW / 2, -(boxH + triSize), boxW, boxH, 4);
      g.endFill();
      // Small triangle pointer
      g.lineStyle(0);
      g.beginFill(0xffffff, 0.95);
      g.drawPolygon([
        -triSize, -triSize,
        triSize, -triSize,
        0, 0,
      ]);
      g.endFill();
    },
    [boxW, boxH],
  );

  return (
    <Container y={-44}>
      <Graphics draw={drawBg} />
      <Text
        text={truncated}
        style={bubbleTextStyle}
        anchor={{ x: 0.5, y: 1 }}
        y={-triSize - BUBBLE_PADDING}
      />
    </Container>
  );
}

export const Character = ({
  textureUrl,
  spritesheetData,
  x,
  y,
  orientation,
  isMoving = false,
  isThinking = false,
  isSpeaking = false,
  emoji = '',
  isViewer = false,
  speed = 0.1,
  onClick,
  bubbleText,
  bubbleTimestamp,
}: {
  // Path to the texture packed image.
  textureUrl: string;
  // The data for the spritesheet.
  spritesheetData: ISpritesheetData;
  // The pose of the NPC.
  x: number;
  y: number;
  orientation: number;
  isMoving?: boolean;
  // Shows a thought bubble if true.
  isThinking?: boolean;
  // Shows a speech bubble if true.
  isSpeaking?: boolean;
  emoji?: string;
  // Highlights the player.
  isViewer?: boolean;
  // The speed of the animation. Can be tuned depending on the side and speed of the NPC.
  speed?: number;
  onClick: () => void;
  // Speech bubble content from conversation messages
  bubbleText?: string;
  bubbleTimestamp?: number;
}) => {
  // Speech bubble visibility: show for BUBBLE_DISPLAY_TIME after each new message
  const [showBubble, setShowBubble] = useState(false);
  useEffect(() => {
    if (!bubbleText || !bubbleTimestamp) {
      setShowBubble(false);
      return;
    }
    setShowBubble(true);
    const elapsed = Date.now() - bubbleTimestamp;
    const remaining = BUBBLE_DISPLAY_TIME - elapsed;
    if (remaining <= 0) {
      setShowBubble(false);
      return;
    }
    const timer = setTimeout(() => setShowBubble(false), remaining);
    return () => clearTimeout(timer);
  }, [bubbleText, bubbleTimestamp]);

  const [spriteSheet, setSpriteSheet] = useState<Spritesheet>();
  useEffect(() => {
    const parseSheet = async () => {
      const sheet = new Spritesheet(
        BaseTexture.from(textureUrl, {
          scaleMode: PIXI.SCALE_MODES.NEAREST,
        }),
        spritesheetData,
      );
      await sheet.parse();
      setSpriteSheet(sheet);
    };
    void parseSheet();
  }, []);

  // The first "left" is "right" but reflected.
  const roundedOrientation = Math.floor(orientation / 90);
  const direction = ['right', 'down', 'left', 'up'][roundedOrientation];

  // Prevents the animation from stopping when the texture changes
  // (see https://github.com/pixijs/pixi-react/issues/359)
  const ref = useRef<PIXI.AnimatedSprite | null>(null);
  useEffect(() => {
    if (isMoving) {
      ref.current?.play();
    }
  }, [direction, isMoving]);

  if (!spriteSheet) return null;

  let blockOffset = { x: 0, y: 0 };
  switch (roundedOrientation) {
    case 2:
      blockOffset = { x: -20, y: 0 };
      break;
    case 0:
      blockOffset = { x: 20, y: 0 };
      break;
    case 3:
      blockOffset = { x: 0, y: -20 };
      break;
    case 1:
      blockOffset = { x: 0, y: 20 };
      break;
  }

  return (
    <Container x={x} y={y} interactive={true} pointerdown={onClick} cursor="pointer">
      {showBubble && bubbleText && <SpeechBubble text={bubbleText} />}
      {isThinking && (
        <Text x={-20} y={-10} scale={{ x: -0.8, y: 0.8 }} text={'💭'} anchor={{ x: 0.5, y: 0.5 }} />
      )}
      {isSpeaking && !showBubble && (
        <Text x={18} y={-10} scale={0.8} text={'💬'} anchor={{ x: 0.5, y: 0.5 }} />
      )}
      {isViewer && <ViewerIndicator />}
      <AnimatedSprite
        ref={ref}
        isPlaying={isMoving}
        textures={spriteSheet.animations[direction]}
        animationSpeed={speed}
        anchor={{ x: 0.5, y: 0.5 }}
      />
      {emoji && (
        <Text x={0} y={-24} scale={{ x: -0.8, y: 0.8 }} text={emoji} anchor={{ x: 0.5, y: 0.5 }} />
      )}
    </Container>
  );
};

function ViewerIndicator() {
  const draw = useCallback((g: PIXI.Graphics) => {
    g.clear();
    g.beginFill(0xffff0b, 0.5);
    g.drawRoundedRect(-10, 10, 20, 10, 100);
    g.endFill();
  }, []);

  return <Graphics draw={draw} />;
}
