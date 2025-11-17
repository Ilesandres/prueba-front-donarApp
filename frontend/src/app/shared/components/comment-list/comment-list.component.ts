import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PostCommentService, PostComment } from '../../../core/services/post-comment.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-comment-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './comment-list.component.html',
  styleUrls: ['./comment-list.component.scss']
})
export class CommentListComponent implements OnInit, OnDestroy, OnChanges {
  @Input() postId!: number;
  @Input() refreshTrigger: number = 0;
  @Output() commentDeleted = new EventEmitter<number>();

  comments: PostComment[] = [];
  loading: boolean = false;
  error: string = '';
  deletingId: number | null = null;

  private destroy$ = new Subject<void>();
  currentUserId: number | string | null = null;

  constructor(
    private commentService: PostCommentService,
    private authService: AuthService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUserId = user?.id || null;
      });

    this.loadComments();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['refreshTrigger'] && !changes['refreshTrigger'].firstChange) {
      this.loadComments();
    }
  }

  loadComments(): void {
    if (!this.postId) {
      this.error = 'Se requiere un ID de publicación';
      return;
    }

    this.loading = true;
    this.error = '';

    this.commentService.getCommentsByPost(this.postId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.comments = Array.isArray(data) ? data : [];
          this.loading = false;
        },
        error: (err) => {
          // Si es 404, el endpoint no existe aún en el backend
          if (err?.status === 404) {
            this.comments = [];
            this.error = '';
            // No mostrar error si el endpoint no existe aún
            console.warn('Endpoint de comentarios no disponible aún en el backend');
          } else {
            this.error = err?.error?.message || 'Error al cargar comentarios';
            this.toastService.error('Error', this.error);
          }
          this.loading = false;
        }
      });
  }

  canDelete(comment: PostComment): boolean {
    if (!this.currentUserId) return false;
    return String(comment.userId) === String(this.currentUserId);
  }

  deleteComment(comment: PostComment): void {
    if (!this.canDelete(comment)) return;
    
    if (!confirm('¿Estás seguro de que deseas eliminar este comentario?')) {
      return;
    }

    this.deletingId = comment.id;

    this.commentService.deleteComment(comment.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Éxito', 'Comentario eliminado exitosamente');
          this.commentDeleted.emit(comment.id);
          this.loadComments();
          this.deletingId = null;
        },
        error: (err) => {
          const errorMsg = err?.error?.message || 'Error al eliminar el comentario';
          this.toastService.error('Error', errorMsg);
          this.deletingId = null;
        }
      });
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 7) {
      return date.toLocaleDateString('es-ES', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } else if (days > 0) {
      return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
    } else if (hours > 0) {
      return `hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
    } else if (minutes > 0) {
      return `hace ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
    } else {
      return 'hace unos segundos';
    }
  }

  trackByCommentId(index: number, comment: PostComment): number {
    return comment.id;
  }
}

